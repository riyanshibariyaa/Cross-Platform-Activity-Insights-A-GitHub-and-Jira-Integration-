const axios = require('axios');  
  
const getJiraAccessToken = async (code) => {  
    try {  
        const response = await axios.post('https://auth.atlassian.com/oauth/token', {  
            grant_type: 'authorization_code',  
            client_id: process.env.JIRA_CLIENT_ID,  
            client_secret: process.env.JIRA_CLIENT_SECRET,  
            code: code,  
            redirect_uri: process.env.JIRA_REDIRECT_URI,  
            scope: 'read:jira-user read:jira-work'  
        }, {  
            headers: {  
                'Content-Type': 'application/json'  
            }  
        });  
        return response.data.access_token;  
    } catch (error) {  
        console.error('Error getting Jira access token:', error);  
        throw new Error('Failed to get Jira access token');  
    }  
};  
  
const getJiraUserData = async (accessToken) => {  
    try {  
        const response = await axios.get('https://api.atlassian.com/me', {  
            headers: {  
                Authorization: `Bearer ${accessToken}`  
            }  
        });  
        return response.data;  
    } catch (error) {  
        console.error('Error fetching Jira user data:', error);  
        throw new Error('Failed to fetch Jira user data');  
    }  
};  
  
const getJiraCloudIds = async (accessToken) => {  
    try {  
        const response = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {  
            headers: {  
                Authorization: `Bearer ${accessToken}`  
            }  
        });  
        return response.data.map(resource => resource.id);  
    } catch (error) {  
        console.error('Error fetching Jira cloud IDs:', error);  
        throw new Error('Failed to fetch Jira cloud IDs');  
    }  
};  
  
const getJiraProjects = async (accessToken, cloudId) => {  
    try {  
        const response = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`, {  
            headers: {  
                Authorization: `Bearer ${accessToken}`  
            }  
        });  
        return response.data;  
    } catch (error) {  
        console.error('Error fetching Jira projects:', error);  
        throw new Error('Failed to fetch Jira projects');  
    }  
};  
  
const getJiraIssues = async (accessToken, cloudId, projectId) => {  
    try {  
        const response = await axios.get(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?jql=project=${projectId}`, {  
            headers: {  
                Authorization: `Bearer ${accessToken}`  
            }  
        });  
        return response.data.issues.map(issue => ({  
            id: issue.id,  
            key: issue.key,  
            summary: issue.fields.summary,  
            status: issue.fields.status.name,  
            priority: issue.fields.priority?.name,  
            created: issue.fields.created,  
            updated: issue.fields.updated  
        }));  
    } catch (error) {  
        console.error('Error fetching Jira issues:', error);  
        throw new Error('Failed to fetch Jira issues');  
    }  
};  
  
const storeJiraUserData = async (userId, userData, projects, issues, accessToken, db) => {  
    try {  
        // Store Jira user data in MongoDB  
        await db.collection('jiraUsers').updateOne(  
            { _id: userId },  
            { $set: { userData, projects, issues, accessToken } },  
            { upsert: true }  
        );  
    } catch (error) {  
        console.error('Error storing Jira user data:', error);  
    }
};

module.exports = {
    getJiraAccessToken,
    getJiraUserData,
    getJiraCloudIds,
    getJiraProjects,
    getJiraIssues,
    storeJiraUserData
};
