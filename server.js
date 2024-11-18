const express = require('express');  
const axios = require('axios');  
const path = require('path');  
const dotenv = require('dotenv');  
const { MongoClient } = require('mongodb');  
const { generateCombinedUserReport } = require("./completion");  
const fs = require('fs');  
const passport = require('passport');  
const GoogleStrategy = require('passport-google-oauth20').Strategy;  
const session = require('express-session');  
const PDFDocument = require('pdfkit'); // Import PDFKit  
const nodeCron = require('node-cron');  
  
const {  
    getJiraAccessToken,    getJiraUserData,  
    getJiraCloudIds,  
    getJiraProjects,  
    getJiraIssues,  
    storeJiraUserData  
} = require('./jira');  
  
dotenv.config();  
  
const app = express();  
const PORT = process.env.PORT || 3001;  
const MONGODB_URI = process.env.MONGODB_URI;  
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;  
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;  
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;  
  
app.use(express.static('public'));  
app.use(express.json());  
  
app.use(session({  
    secret: 'your_secret_key', // Replace with a secure secret key  
    resave: false,  
    saveUninitialized: true,  
    cookie: { secure: false } // Set to true if using https  
}));  
  
app.use(passport.initialize());  
app.use(passport.session());  
  
// MongoDB Connection  
let db;  
(async () => {  
    try {  
        const client = new MongoClient(MONGODB_URI);  
        await client.connect();  
        console.log("Connected to MongoDB");  
        db = client.db();  
    } catch (error) {  
        console.error("Error connecting to MongoDB:", error);  
    }  
})();  
app.post('/nango-webhook', async (req, res) => {
    try {
        // Store received data in MongoDB
        await db.collection('webhookData').insertOne(req.body);
        console.log("Data stored in MongoDB:", req.body);
  
        // Forward the received data to a webhook
        // Implement your webhook logic here
  
        res.status(200).send("Webhook received the data successfully");
    } catch (error) {
        console.error("Error processing webhook:", error);
        res.status(500).send("Internal Server Error");
    }
  });
  
passport.use(new GoogleStrategy({  
    clientID: process.env.GOOGLE_CLIENT_ID,  
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,  
    callbackURL: "/auth/google/callback"  
}, (accessToken, refreshToken, profile, done) => {  
    done(null, profile);  
}));  
  
passport.serializeUser((user, done) => {  
    done(null, user);  
});  
  
passport.deserializeUser((obj, done) => {  
    done(null, obj);  
});  
  
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));  
  
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {  
    req.session.user = req.user;  
    res.redirect('/oauth/github');  
});  
  
app.get('/oauth/github', (req, res) => {  
    res.redirect(`https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo,user`);  
});  
  
app.get('/oauth/github/callback', async (req, res) => {  
    const code = req.query.code;  
    if (!code) {  
        return res.status(400).send('No code provided');  
    }  
  
    try {  
        // Exchange GitHub code for access token  
        const githubResponse = await axios.post('https://github.com/login/oauth/access_token', {  
            client_id: GITHUB_CLIENT_ID,  
            client_secret: GITHUB_CLIENT_SECRET,  
            code: code,  
            redirect_uri: GITHUB_REDIRECT_URI  
        }, {  
            headers: {  
                accept: 'application/json'  
            }  
        });  
  
        const githubAccessToken = githubResponse.data.access_token;  
  
        // Fetch GitHub user data  
        const githubUserResponse = await axios.get('https://api.github.com/user', {  
            headers: {  
                Authorization: `token ${githubAccessToken}`  
            }  
        });  
  
        const githubUserId = githubUserResponse.data.id;  
  
        // Store GitHub user data in MongoDB  
        const githubUserDoc = {  
            _id: githubUserId,  
            accessToken: githubAccessToken,  
            repositories: [],  
            emails: [],
            issues: [],  
            pullRequests: [] 
        };  
  
        await db.collection('users').updateOne({ _id: githubUserId }, { $set: githubUserDoc }, { upsert: true });  
  
        // Fetch user repositories and emails in parallel  
        const [reposResponse, emailsResponse] = await Promise.all([  
            axios.get('https://api.github.com/user/repos', {  
                headers: {  
                    Authorization: `token ${githubAccessToken}`  
                }  
            }),  
            axios.get('https://api.github.com/user/emails', {  
                headers: {  
                    Authorization: `token ${githubAccessToken}`  
                }  
            })  
        ]); 
        
        // Fetch issues and pull requests for each repository  
        const repoIssuesAndPullsPromises = reposResponse.data.map(repo => {  
            const repoOwner = repo.owner.login;  
            const repoName = repo.name;  
        
            return Promise.all([  
                axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {  
                    headers: {  
                        Authorization: `token ${githubAccessToken}`  
                    }  
                }),  
                axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {  
                    headers: {  
                        Authorization: `token ${githubAccessToken}`  
                    }  
                })  
            ]);  
        });  
  
        const repoIssuesAndPullsResponses = await Promise.all(repoIssuesAndPullsPromises);  
        
        // Aggregate issues and pull requests  
        githubUserDoc.issues = repoIssuesAndPullsResponses.flatMap(([issuesResponse]) => issuesResponse.data);  
        githubUserDoc.pullRequests = repoIssuesAndPullsResponses.flatMap(([, pullsResponse]) => pullsResponse.data);  
        
        
 
  

        githubUserDoc.repositories = reposResponse.data;  
        githubUserDoc.emails = emailsResponse.data; 
        
        // Update the user document with repositories and emails  
        await db.collection('users').updateOne({ _id: githubUserId }, { $set: githubUserDoc });  
  
        // Store GitHub user ID in session for later use in Jira OAuth callback  
        req.session.githubUserId = githubUserId;  
  
        // Proceed to Jira OAuth  
        res.redirect('https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=' + process.env.JIRA_CLIENT_ID + '&scope=read%3Ame%20read%3Aaccount%20read%3Ajira-work&redirect_uri=' + process.env.JIRA_REDIRECT_URI + '&state=random_state_string&response_type=code&prompt=consent');  
    } catch (error) {  
        console.error('Error exchanging code for token:', error);  
        res.status(500).send('Internal Server Error');  
    }  
});  
  
// Jira OAuth callback  
app.get('/oauth/jira/callback', async (req, res) => {  
    const code = req.query.code;  
    if (!code) {  
        return res.status(400).send('No code provided');  
    }  
  
    try {  
        const jiraAccessToken = await getJiraAccessToken(code);  
        const jiraUserData = await getJiraUserData(jiraAccessToken);  
  
        const jiraUserId = jiraUserData.account_id;  
  
        // Fetch Jira cloud IDs  
        const cloudIds = await getJiraCloudIds(jiraAccessToken);  
        let projects = [];  
        let issuesData = [];  
  
        if (cloudIds && cloudIds.length > 0) {  
            const cloudId = cloudIds[0];  
            projects = await getJiraProjects(jiraAccessToken, cloudId);  
  
            if (projects && projects.length > 0) {  
                const issuesPromises = projects.map(project => getJiraIssues(jiraAccessToken, cloudId, project.id));  
                const issues = await Promise.all(issuesPromises);  
                issuesData = issues.flat(); // Flatten the array of issues arrays  
            }  
        }  
  
        await storeJiraUserData(jiraUserId, jiraUserData, projects, issuesData, jiraAccessToken, db);  
  
        // Retrieve GitHub user ID from session  
        const githubUserId = req.session.githubUserId;  
  
        if (githubUserId) {  
            await db.collection('userMappings').updateOne(  
                { githubUserId: githubUserId },  
                { $set: { jiraUserId: jiraUserId } },  
                { upsert: true }  
            );  
            // Generate combined user report  
            const pdfPath = await generateCombinedUserReport(req.session.user.id, githubUserId, jiraUserId, db);  
  
            // Serve the generated PDF file  
            res.sendFile(path.resolve(pdfPath));  
        } else {  
            res.status(400).send('GitHub user ID not found in session');  
        }  
    } catch (error) {  
        console.error('Error during Jira OAuth callback:', error);  
        res.status(500).send('Internal Server Error');  
    }  
});  
async function updateGitHubAndJiraData() {  
    try {  
        // Fetch and update GitHub data  
        const githubUsers = await db.collection('users').find().toArray();  
        for (const user of githubUsers) {  
            const githubAccessToken = user.accessToken;  
            const [reposResponse, emailsResponse, issuesResponse, pullsResponse] = await Promise.all([  
                axios.get('https://api.github.com/user/repos', {  
                    headers: { Authorization: `token ${githubAccessToken}` }  
                }),  
                axios.get('https://api.github.com/user/emails', {  
                    headers: { Authorization: `token ${githubAccessToken}` }  
                })
            ]);  
            // Fetch issues and pull requests for each repository  
            const repoIssuesAndPullsPromises = reposResponse.data.map(repo => {  
                const repoOwner = repo.owner.login;  
                const repoName = repo.name;  
        
                return Promise.all([  
                    axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {  
                        headers: {  
                            Authorization: `token ${githubAccessToken}`  
                        }  
                    }),  
                    axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {  
                        headers: {  
                            Authorization: `token ${githubAccessToken}`  
                        }  
                    })  
                ]);  
            });  
        
            const repoIssuesAndPullsResponses = await Promise.all(repoIssuesAndPullsPromises);  
        
            // Aggregate issues and pull requests  
            const issues = repoIssuesAndPullsResponses.flatMap(([issuesResponse]) => issuesResponse.data);  
            const pullRequests = repoIssuesAndPullsResponses.flatMap(([, pullsResponse]) => pullsResponse.data);  
        
            await db.collection('users').updateOne(  
                { _id: user._id },  
                { $set: { repositories: reposResponse.data, emails: emailsResponse.data, issues, pullRequests } }  
            );  
        }  
      

        // Fetch and update Jira data  
        const jiraUsers = await db.collection('jiraUsers').find().toArray();  
        for (const user of jiraUsers) {  
            const jiraAccessToken = user.accessToken;  
            const jiraUserData = await getJiraUserData(jiraAccessToken);  
            const cloudIds = await getJiraCloudIds(jiraAccessToken);  
            let projects = [];  
            let issuesData = [];  

            if (cloudIds && cloudIds.length > 0) {  
                const cloudId = cloudIds[0];  
                projects = await getJiraProjects(jiraAccessToken, cloudId);  

                if (projects && projects.length > 0) {  
                    const issuesPromises = projects.map(project => getJiraIssues(jiraAccessToken, cloudId, project.id));  
                    const issues = await Promise.all(issuesPromises);  
                    issuesData = issues.flat(); // Flatten the array of issues arrays  
                }  
            }  

            await storeJiraUserData(user._id, jiraUserData, projects, issuesData, jiraAccessToken, db);  
        }  
        // Fetch user mappings  
       const userMappings = await db.collection('userMappings').find().toArray();  

       // Generate combined reports based on the mappings  
       for (const mapping of userMappings) {  
           const { githubUserId, jiraUserId } = mapping;  
        const sessionUserId = githubUserId;  
           await generateCombinedUserReport(sessionUserId, githubUserId, jiraUserId, db);  
       }
    } catch (error) {  
        console.error('Error updating GitHub and Jira data:', error);  
    }  
}  
// Schedule the cron job to run once a day at midnight  
// nodeCron.schedule('* * * * *', async () => {  
//     console.log('Running daily update of GitHub and Jira data');  
//     await updateGitHubAndJiraData();  
// });   
nodeCron.schedule('0 0 0 * * *', async () => {  
    console.log('Running daily update of GitHub and Jira data');  
    await updateGitHubAndJiraData();  
});   

  
app.listen(PORT, () => {  
    console.log(`Server is running on port ${PORT}`);  
});  
