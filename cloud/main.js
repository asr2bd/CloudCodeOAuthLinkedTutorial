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
var CLIENT_ID = '450953848085-2muj2092fsqtllf2il1lj8uqmjq41j0c.apps.googleusercontent.com'
var CLIENT_SECRET = 'OvPlHWuOerIiEvlLTkSX4zVm';

var state = '';
var access_token = '';
var token_type = '';
var expires = '';


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


// Start the OAuth flow by generating a URL that the client (index.html) opens 
// as a popup. The URL takes the user to Google's site for authentication
app.get("/login", function(req, res) {
  

    // Generate a unique number that will be used to check if any hijacking
    // was performed during the OAuth flow
    state = Math.floor(Math.random() * 1e18);

    var tokenRequest = new TokenRequest();
    // Secure the object against public access.
    tokenRequest.setACL(restrictedAcl);
    /**
    * Save this request in a Parse Object for validation when GitHub responds
    * Use the master key because this class is protected
    */
    tokenRequest.save(null, { useMasterKey: true }).then(function(obj) {
    /**
     * Redirect the browser to GitHub for authorization.
     * This uses the objectId of the new TokenRequest as the 'state'
     *   variable in the GitHub redirect.
     */
        var params = {
            response_type: "code",
            client_id: CLIENT_ID,
            redirect_uri: callbackURL,
            state: obj.id,
            scope: "https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive"
        };
        
        params = qs.stringify(params);
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.redirect("https://accounts.google.com/o/oauth2/auth?" + params);
    );
    
    }, function(error) {
    // If there's an error storing the request, render the error page.
    res.render('error', { errorMessage: 'Failed to save auth request.'});
    });

});

// The route that Google will redirect the popup to once the user has authed.
// The data passed back will be used to retrieve the access_token
app.get("/callback", function(req, res) {
  
    // Collect the data contained in the querystring
    var code = req.query.code
      , cb_state = req.query.state
      , error = req.query.error;
  
    // Verify the 'state' variable generated during '/login' equals what was passed back

    console.log("***** this is the state **** " + state);
    console.log("***** this is the cb_state **** " + cb_state);

    if (state == cb_state) {
        Parse.Cloud.httpRequest({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: { 
                    'code': code,
                    'client_id': CLIENT_ID,
                    'client_secret': CLIENT_SECRET,
                    'redirect_uri': callbackURL,
                    'grant_type': "authorization_code"
                },
            url: url,
                success: function(httpResponse) {
                    var results = JSON.parse(httpResponse);
                    console.log(httpResponse.text);
                    if (results.error) { 
                    
                        return console.error("Error returned from Google: ", results.error);

                    }

                    else {

                        access_token = results.access_token;
                        token_type = results.token_type;
                        expires = results.expires_in;
                        console.log("Connected to Google");


                    }


                },
                error: function(httpResponse) {
                    console.error("Error returned from Google: ", httpResponse.error);
                        }
                }); 

    }
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


