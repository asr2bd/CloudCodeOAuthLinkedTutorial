/**
 * Load needed modules.
 */
var express = require('express');
var _ = require('underscore');
var Buffer = require('buffer').Buffer;

/**
 * Create an express application instance
 */
var app = express();
var LinkedInLink = Parse.Object.extend("LinkedInLink");


/**
 * Create a Parse ACL which prohibits public access.  This will be used
 *   in several places throughout the application, to explicitly protect
 *   Parse User and LinkedInLink objects.
 */
var restrictedAcl = new Parse.ACL();
restrictedAcl.setPublicReadAccess(false);
restrictedAcl.setPublicWriteAccess(false);

/**
 * Global app configuration section
 */
app.set('views', 'cloud/views');  // Specify the folder to find templates
app.set('view engine', 'ejs');    // Set the template engine
app.use(express.bodyParser());    // Middleware for reading request body

/**
 * Main route.
 * When called, render the login.ejs view
 */
app.get('/', function (req, res) {
    res.render('login', {});
});

/**
 * Logged in route.
 *
 * JavaScript will validate login and call a Cloud function to get the users
 */
app.get('/main', function (req, res) {
    res.render('main', {});
});

/**
 * Attach the express app to Cloud Code to process the inbound request.
 */
app.listen();

Parse.Cloud.define('loadLinkedInMember', function (request, response) {
    var member = request.params.values[0];
    upsertLinkedInUser(member).then(function (user) {
        return response.success(user.getSessionToken());
    });
});


/**
 * This function checks to see if this LinkedIn user has logged in before.
 * It expects a class in your Parse App called 'LinkedInLink' which is a simple table that links Parse Users to linkeIn Ids
 * the LinkedInLink calss shoudl have two colums : 
 *      'user' : pointer to Parse User
 *      'linkInId' : string that holds the unique LinkedIn user ID
 * If the user is found return
 *   the users token.  If not found, return the newLinkedInUser promise.
 */
function upsertLinkedInUser(member) {

    var query = new Parse.Query(LinkedInLink);
    query.equalTo('linkedInId', member.id);
    query.ascending('createdAt');

    // Check if this linkedInId has previously logged in, using the master key
    return query.first({ useMasterKey: true }).then(function (tokenData) {
        // If not, create a new user.
        if (!tokenData) {
            return newLinkedInUser(member);
        }

        // If found, fetch the user.
        var user = tokenData.get('user');
        return user.fetch({ useMasterKey: true }).then(function (user) {
            return tokenData.save(null, { useMasterKey: true });
        }).then(function (obj) {
                // Return the user object.
                return Parse.Promise.as(user);
            });
    });
}

/**
 * This function creates a Parse User with a random  password, and
 *   associates it with an object in the LinkedInLink class.
 * Once completed, this will return upsertLinkedInUser.  This is done to protect
 *   against a race condition:  In the rare event where 2 new users are created
 *   at the same time, only the first one will actually get used.
 */
var newLinkedInUser = function (linkedInData) {

    var user = new Parse.User();
    
    
        // Generate a random  password.
        var password = new Buffer(24);
        _.times(24, function (i) {
            password.set(i, _.random(0, 255));
        });
        user.set("username", linkedInData.firstName + linkedInData.lastName);
        user.set("password", password.toString('base64'));
        user.set("email", linkedInData.emailAddress);
        user.set("firstName",linkedInData.firstName);
        user.set("lastName",linkedInData.lastName);
        user.set("company",savedCompany);
        user.setACL(restrictedAcl);

        // Sign up the new User
        return user.signUp().then(function (user) {
            // create a new LinkedInLink object to store the user+LinkedIn association.
            var ts = new LinkedInLink();
            ts.set('linkedInId', linkedInData.id);
            ts.set('user', user);
            ts.setACL(restrictedAcl);
            // Use the master key because LinkedInLink objects should be protected.
            return ts.save(null, { useMasterKey: true });
        }).then(function (tokenStorage) {
                return upsertLinkedInUser(linkedInData);
            });

}
