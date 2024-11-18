const fs = require('fs');
const { AzureOpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");
const pdf = require("html-pdf");
const { marked } = require("marked");
const { font, fontSize } = require("pdfkit");
require('dotenv').config();

if (!process.env.AZURE_TENANT_ID ||!process.env.AZURE_CLIENT_ID ||!process.env.AZURE_CLIENT_SECRET) {
  throw new Error("Missing Azure environment variables");
}

const deployment = "Jirawork";
const apiVersion = "2024-04-01-preview";
const client = new AzureOpenAI({
  endpoint: "https://jira-work.openai.azure.com/",
  apiKey: "9b1e700783664f7f97e79f050d4082e6",
  apiVersion,
  deployment
});


async function generateCombinedUserReport(sessionUserId, githubUserId, jiraUserId, db) {  
    try {  
        const githubUser = await db.collection('users').findOne({ _id: githubUserId });  
        const jiraUser = await db.collection('jiraUsers').findOne({ _id: jiraUserId });  
  
        if (!githubUser || !jiraUser) {  
            throw new Error(`User data not found for GitHub ID ${githubUserId} or Jira ID ${jiraUserId}`);  
        }  
  
        
  
        const jiraUserSummary = {  
            username: jiraUser.username,  
            accountId: jiraUser._id,  
            email: jiraUser.email,  
            projectsCount: jiraUser.projects.length,  
            issues: jiraUser.issues.map(issue => ({  
                id: issue.id,  
                key: issue.key,  
                summary: issue.summary,  
                status: issue.status,  
                priority: issue.priority,  
                created: issue.created,  
                updated: issue.updated  
            }))  
        };  
  
        const reportId = uuidv4();  
        const githubPrompt = `  
        Using the provided GitHub  data, generate a concise report for the user. Give an overall report heading saying it's a report for the (mention username) user's GitHub and Jira account. The GitHub section should provide an overview of key statistics, including the username, ID, emails, number of repositories, primary languages, stars, forks, and issues. It should include a detailed narrative breakdown of each and every repository, issues, and pull requests, covering its description, language, visibility, creation and update dates, stars, forks, issues, and functionalities.  
        GitHub User Data: ${JSON.stringify(githubUser)}  
        `;  
  
        const jiraPrompt = `  
        Generate a concise report for the Jira user.The Jira section should present key statistics, including the username, account ID, email, projects, issues, and activity levels. It should provide a detailed narrative analysis of 10 projects, covering its description, key statistics, and functionalities. Additionally, include a comprehensive analysis of 4-5 issues within each projects, detailing status id, key, summary, status, priority, created and updated in the form of a table.The table should strictly have the grid lines and proper spacing using HTML and CSS. Use the <table>, <tr>, <th>, and <td> tags, and include inline CSS for styling. Don't give the html css code instead for forming the actuall table 
        Jira User Data: ${JSON.stringify(jiraUserSummary)}  
        `;  
  
        const githubResult = await client.chat.completions.create({  
            messages: [{ role: "system", content: githubPrompt }],  
            model: "gpt-4",  
        });  
  
        const jiraResult = await client.chat.completions.create({  
            messages: [{ role: "system", content: jiraPrompt }],  
            model: "gpt-4",  
        });  
  
        const reportContent = `  
          
        GitHub Overview:  
        ${githubResult.choices[0].message.content}  
  
        Jira Overview:  
        ${jiraResult.choices[0].message.content}  
        `;  
  
        const htmlContent = marked(reportContent);  
        const options = {  
            format: "Letter",  
            border: {  
                top: "0.5in",  
                right: "0.2in",  
                bottom: "0.5in",  
                left: "0.2in"  
            }  
        };  
        const pdfPath = `reports/${githubUserId}_combined_report.pdf`;  
  
        pdf.create(htmlContent, options).toFile(pdfPath, (err, res) =>{
            if (err) return console.log(err);  
        console.log(res);  
    });  

    return pdfPath;  
} catch (error) {  
    console.error('Error generating combined user report:', error);  
}  
}  

module.exports = {  
generateCombinedUserReport,  
};  
