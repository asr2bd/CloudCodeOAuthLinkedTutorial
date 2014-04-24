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
var CLIENT_ID = '1024175819480-9qrjco6pflj35tk2ut634ce8fdsrskcm.apps.googleusercontent.com'
var CLIENT_SECRET = 'ibHt6MbFo8LvtuGSrrKVHopt';

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
            scope: "https://www.googleapis.com/auth/plus.login https://www.googleapis.com/auth/plus.profile.emails.read https://www.googleapis.com/auth/drive"
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
        console.log(googleData);
        if (googleData && googleData.access_token && googleData.token_type) {
            token = googleData.access_token;
            return getGoogleUserDetails(token);
        } 
        else {
            return Parse.Promise.error("Invalid access request.");
        }

    }).then(function(userData) {
        console.log("------------USER DATA-------------");

        console.log(userData);


    }, function(error) {
        if (error && error.code && error.error) {
          error = error.code + ' ' + error.error;
        }
        res.send(JSON.stringify(error));
    });
});

// Test out the access_token by making an API call
app.get("/user", function(req, res) {
  
    // Check to see if user as an access_token first
    if (access_token) {
      
        // URL endpoint and params needed to make the API call  
        var url = "https://www.googleapis.com/oauth2/v1/userinfo";
        var params = {
            access_token: access_token
        };

        // Send the request
        request.get({url: url, qs: params}, function(err, resp, user) {
            // Check for errors
            if (err) return console.error("Error occured: ", err);
            
            // Send output as response
            var output = "<h1>Your User Details</h1><pre>" + user + "</pre>";
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(output);
        });
    } else {
        console.log("Couldn't verify user was authenticated. Redirecting to /");
        res.redirect("/");
    }
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
}

var getGoogleUserDetails = function(accessToken) {
  return Parse.Cloud.httpRequest({
    method: 'GET',
    url: "https://www.googleapis.com/plus/v1/people/me",
    params: { access_token: accessToken },
    headers: {
      'User-Agent': 'Parse.com Cloud Code'
    }
  });
}

//TODO: verify headers are correct, verify that query parameter is being passed right, pass in access token somewhere
var getGoogleDriveFiles = function(query) {
    var body = qs.stringify({
        q: query
    });

    var url = "https://www.googleapis.com/drive/v2/files";

    return Parse.Cloud.httpRequest({
        method: 'GET',
        headers: {
            'Host': 'accounts.google.com',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body,
        url: url
    });
}
