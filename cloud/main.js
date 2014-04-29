/**
 * Load needed modules.
 */
var express = require('express');
var qs = require('querystring');
var _ = require('underscore');
var Buffer = require('buffer').Buffer;

var parseExpressHttpsRedirect = require('parse-express-https-redirect');
var parseExpressCookieSession = require('parse-express-cookie-session');

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

app.use(express.cookieParser('my_super_secret_key'));
app.use(parseExpressCookieSession({ cookie: { maxAge: 3600 } })); //1 hour

// Define API credentials callback URL
var callbackURL = "https://clarkauth.parseapp.com/callback";
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
            scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email"
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
        var userData = userDataResponse.data;
        if (userData && userData.email && userData.id) {
            return upsertGoogleUser(token, userData);
        } 
        else {
            return Parse.Promise.error("Unable to parse Google data.");
        }
    }).then(function(user) {
        var username = user.getUsername();
        var password = user.get("pw");
        return Parse.User.logIn(username, password);
    }).then(function(user) {
        res.send(user);
    }, function(error) {
        if (error && error.code && error.error) {
          error = error.code + ' ' + error.error;
        }
        res.send(JSON.stringify(error));
    });
});

app.get("/images", function(req, res) {
    var building = req.body.building;
    var floor = req.body.floor;
    var room = req.body.room;

    Parse.Promise.as().then(function() {
        var query = "title = 'Latch Buildings' and trashed = false";
        return getGoogleDriveFiles(accessToken, query);
    }).then(function(files) {
        //check to see is latch buildings exists

        var folderId = files.items[0].id;
        var query = folderId + " in parents and trashed = false";
        return getGoogleDriveFiles(accessToken, query);
    }).then(function(files) {
        files.items.forEach(function(file) {
            if (file.title == building) {
                var query = file.id + " in parents and trashed = false";
                return getGoogleDriveFiles(accessToken, query);
            }
        });

        //building not found

    }).then(function(files) {
        files.items.forEach(function(file) {
            if (file.title == floor) {
                var query = file.id + " in parents and trashed = false";
                return getGoogleDriveFiles(accessToken, query);
            }
        });

        //floor not found

    }).then(function(files) {
        files.items.forEach(function(file) {
            if (file.title == room) {
                var query = file.id + " in parents and trashed = false";
                return getGoogleDriveFiles(accessToken, query);
            }
        });

        //room not found

    }).then(function(images) {
        var urls = [];
        var template = "https://drive.google.com/uc?id=";
        images.items.forEach(function(image) {
            var url = template + "" + image.id;
        });
        
        res.send(urls);
    }, function(error) {

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
    var url = "https://www.googleapis.com/userinfo/v2/me";

    var authorization = "Bearer";
    authorization = authorization + ' ' + accessToken; 

    return Parse.Cloud.httpRequest({
        method: 'GET',
        url: url,
        headers: {
            'User-Agent': 'Parse.com Cloud Code',
            'Authorization': authorization
        }
    });
};

var upsertGoogleUser = function(accessToken, googleData) {
    var query = new Parse.Query(TokenStorage);
    query.equalTo('googleId', googleData.id);
    query.ascending('createdAt');

    return query.first({ useMasterKey: true }).then(function(tokenData) {
        if (!tokenData) {
            return newGoogleUser(accessToken, googleData);
        }

        var user = tokenData.get('user');
        return user.fetch({ useMasterKey: true }).then(function(user) {
            if (accessToken !== tokenData.get('accessToken')) {
                tokenData.set('accessToken', accessToken);
            }

            return tokenData.save(null, { useMasterKey: true });
        }).then(function(obj) {
            return Parse.Promise.as(user);
        });
    });
}

var newGoogleUser = function(accessToken, googleData) {
    var user = new Parse.User();

    var username = new Buffer(24);
    var password = new Buffer(24);
    _.times(24, function(i) {
        username.set(i, _.random(0, 255));
        password.set(i, _.random(0, 255));
    });
    user.set("username", username.toString('base64'));
    user.set("password", password.toString('base64'));
    user.set("pw", password.toString('base64'));

    return user.signUp().then(function(user) {
        var ts = new TokenStorage();
        ts.set('googleId', googleData.id);
        ts.set('googleEmail', googleData.email);
        ts.set('accessToken', accessToken);
        ts.set('user', user);
        ts.setACL(restrictedAcl);

        return ts.save(null, { useMasterKey: true });
    }).then(function(tokenStorage) {
        return upsertGoogleUser(accessToken, googleData);
    });
}

var getGoogleDriveFiles = function(accessToken, query) {
    var url = "https://www.googleapis.com/drive/v2/files";

    var authorization = "Bearer";
    authorization = authorization + ' ' + accessToken; 
    
    return Parse.Cloud.httpRequest({
        method: 'GET',
        url: url,
        params: {
            q: query,
            maxResults: 1000
        },
        headers: {
            'User-Agent': 'Parse.com Cloud Code',
            'Authorization': authorization
        }
    });
};
