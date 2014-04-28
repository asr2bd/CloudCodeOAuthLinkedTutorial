/**
 * Load needed modules.
 */
var express = require('express');
var qs = require('querystring');
var _ = require('underscore');
var Buffer = require('buffer').Buffer;

/**
 * Create an express application instance
 */
var app = express();

/**
 * Global app configuration section
 */
app.set('views', 'cloud/views');  // Specify the folder to find templates
app.set('view engine', 'ejs');    // Set the template engine
app.use(express.bodyParser());    // Middleware for reading request body

// Define API credentials callback URL
var callbackURL = "https://clarkoauth.parseapp.com/callback";
var CLIENT_ID = '141607548124-po4hd97cvh8t16ska4biobrmrjuaaqvv.apps.googleusercontent.com';
var CLIENT_SECRET = '2QP1HwxHA6QttHqR-rk3MQGq';

/**
 * In the Data Browser, set the Class Permissions for these 2 classes to
 *   disallow public access for Get/Find/Create/Update/Delete operations.
 * Only the master key should be able to query or write to these classes.
 */
var TokenRequest = Parse.Object.extend("TokenRequest");
var TokenStorage = Parse.Object.extend("TokenStorage");

/**
 * Create a Parse ACL which prohibits public access.  This will be used
 *   in several places throughout the application, to explicitly protect
 *   Parse User, TokenRequest, and TokenStorage objects.
 */
var restrictedAcl = new Parse.ACL();
restrictedAcl.setPublicReadAccess(false);
restrictedAcl.setPublicWriteAccess(false);

app.get("/", function(req, res) {
    res.redirect("/login");
});

// Start the OAuth flow by generating a URL that the client (index.html) opens 
// as a popup. The URL takes the user to Google's site for authentication
app.get("/login", function(req, res) {
    
    var tokenRequest = new TokenRequest();
    tokenRequest.setACL(restrictedAcl);
    tokenRequest.save(null, { useMasterKey: true }).then(function(obj) {
        var params = {
            response_type: "code",
            client_id: CLIENT_ID,
            redirect_uri: callbackURL,
            state: obj.id,
            scope: "https://www.googleapis.com/auth/plus.login https://www.googleapis.com/auth/drive"
        };
            
        params = qs.stringify(params);
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.redirect("https://accounts.google.com/o/oauth2/auth?" + params);

    }, function(error) {
        // If there's an error storing the request, render the error page.
        res.render('error', { errorMessage: 'Failed to save auth request.'});
    });
});

// The route that Google will redirect the popup to once the user has authed.
// The data passed back will be used to retrieve the access_token
app.get("/callback", function(req, res) {
  
    // Collect the data contained in the querystring
    var data = req.query;
    var token;
  
    // Verify the 'state' variable generated during '/login' was passed back
    if (!(data && data.code && data.state)) {
        res.send('Invalid auth response received.');
        return;
    }

    var query = new Parse.Query(TokenRequest);
    /**
    * Check if the provided state object exists as a TokenRequest
    * Use the master key as operations on TokenRequest are protected
    */
    Parse.Cloud.useMasterKey();

    Parse.Promise.as().then(function() {
        return query.get(data.state);
    }).then(function(obj) {
        // Destroy the TokenRequest before continuing.
        return obj.destroy();
    }).then(function() {
        // Validate & Exchange the code parameter for an access token from Google
        return getGoogleAccessToken(data.code);
    }).then(function(access) {
        var googleData = access.data;
        if (googleData && googleData.access_token && googleData.token_type) {
            token = googleData.access_token;
            return getGoogleUserDetails(token);
        } 
        else {
            return Parse.Promise.error("Invalid access request.");
        }

    }).then(function(userDataResponse) {
        return getGoogleDriveFiles("sharedWithMe");
        // var userData = userDataResponse.data;
        // if (userData && userData.login && userData.id) {
        //     return upsertGitHubUser(token, userData);
        // } 
        // else {
        //     return Parse.Promise.error("Unable to parse Google data.");
        // }
    }).then(function(files) {
        console.log("HERE");
        console.log(files);

    }, function(error) {
        if (error && error.code && error.error) {
          error = error.code + ' ' + error.error;
        }
        res.send(JSON.stringify(error));
    });
});

/**
 * Attach the express app to Cloud Code to process the inbound request.
 */
app.listen();


var getGoogleAccessToken = function(code) {
    var body = qs.stringify({
        code: code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: callbackURL,
        grant_type: "authorization_code"
    });

    var url = "https://accounts.google.com/o/oauth2/token";

    return Parse.Cloud.httpRequest({
        method: 'POST',
        headers: {
            'Host': 'accounts.google.com',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body,
        url: url
    });
};

var getGoogleUserDetails = function(accessToken) {

    console.log("in the function");

    //var url = "https://www.googleapis.com/oauth2/v2/userinfo";
    var url = "https://www.googleapis.com/userinfo/v2/me";
    //var url = "https://www.googleapis.com/drive/v2/files";

    return Parse.Cloud.httpRequest({
        method: 'GET',
        url: url,
        params: { 
            access_token: accessToken
        },
        headers: {
            'User-Agent': 'Parse.com Cloud Code'
        }
    });
};

//TODO: verify headers are correct, verify that query parameter is being passed right, pass in access token somewhere
var getGoogleDriveFiles = function(query) {
    var params = qs.stringify({
        q: query,
        access_token: accessToken
    });

    var url = "https://www.googleapis.com/drive/v2/files";
    
    return Parse.Cloud.httpRequest({
        method: 'GET',
        url: url,
        params: params,
        headers: {
            'User-Agent': 'Parse.com Cloud Code'
        }
    });
};
