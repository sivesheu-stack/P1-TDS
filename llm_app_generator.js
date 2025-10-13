// server.js
const express = require('express');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai'; // 'openai' or 'anthropic'
const PORT = process.env.PORT || 3000;

// Initialize clients
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Store task states (in production, use a database)
const taskStates = new Map();

// Helper: Generate app code using LLM
async function generateAppCode(taskDescription, existingCode = null, round = 1) {
  const prompt = existingCode 
    ? `You are updating an existing web application. Here's the current code:\n\n${existingCode}\n\nUpdate Request (Round ${round}):\n${taskDescription}\n\nProvide the complete updated HTML file with inline CSS and JavaScript. Make sure it's a fully functional single-page application.`
    : `Create a complete, fully functional single-page web application based on this description:\n\n${taskDescription}\n\nProvide a single HTML file with inline CSS and JavaScript. Make it visually appealing and fully functional. Include all necessary code in one file.`;

  if (LLM_PROVIDER === 'anthropic') {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );
    
    return response.data.content[0].text;
  } else {
    // OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert web developer. Create complete, functional HTML applications with inline CSS and JavaScript.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 4096
    });

    return response.choices[0].message.content;
  }
}

// Helper: Extract HTML from LLM response
function extractHTML(llmResponse) {
  // Try to extract HTML from markdown code blocks
  const htmlMatch = llmResponse.match(/```html\n([\s\S]*?)\n```/);
  if (htmlMatch) {
    return htmlMatch[1];
  }
  
  // If no code block, check if response starts with HTML
  if (llmResponse.trim().startsWith('<!DOCTYPE') || llmResponse.trim().startsWith('<html')) {
    return llmResponse.trim();
  }
  
  // Otherwise, wrap it in basic HTML structure
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated App</title>
</head>
<body>
    ${llmResponse}
</body>
</html>`;
}

// Helper: Create or update GitHub repo
async function createOrUpdateRepo(repoName, htmlContent, isUpdate = false) {
  try {
    let repo;
    
    if (!isUpdate) {
      // Create new repository
      repo = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: 'Auto-generated app from LLM',
        auto_init: true,
        private: false
      });
      
      // Enable GitHub Pages
      await octokit.repos.createPagesSite({
        owner: GITHUB_USERNAME,
        repo: repoName,
        source: {
          branch: 'main',
          path: '/'
        }
      });
    } else {
      // Get existing repo
      repo = await octokit.repos.get({
        owner: GITHUB_USERNAME,
        repo: repoName
      });
    }

    // Get the SHA of index.html if it exists (for updates)
    let sha = null;
    if (isUpdate) {
      try {
        const { data: file } = await octokit.repos.getContent({
          owner: GITHUB_USERNAME,
          repo: repoName,
          path: 'index.html'
        });
        sha = file.sha;
      } catch (err) {
        // File doesn't exist yet
      }
    }

    // Create or update index.html
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_USERNAME,
      repo: repoName,
      path: 'index.html',
      message: isUpdate ? 'Update app (Round 2+)' : 'Initial commit: Generated app',
      content: Buffer.from(htmlContent).toString('base64'),
      ...(sha && { sha })
    });

    const repoUrl = repo.data.html_url;
    const pagesUrl = `https://${GITHUB_USERNAME}.github.io/${repoName}`;

    return { repoUrl, pagesUrl, success: true };
  } catch (error) {
    console.error('GitHub error:', error.message);
    throw error;
  }
}

// Helper: Send results to evaluation API
async function sendToEvaluationAPI(evaluationUrl, results) {
  try {
    await axios.post(evaluationUrl, results, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    return { success: true };
  } catch (error) {
    console.error('Evaluation API error:', error.message);
    return { success: false, error: error.message };
  }
}

// POST /task - Handle task requests (Round 1 and Round 2)
app.post('/task', async (req, res) => {
  const { taskId, description, evaluationUrl, round = 1, repoName: existingRepoName } = req.body;

  // Validation
  if (!taskId || !description || !evaluationUrl) {
    return res.status(400).json({
      error: 'Missing required fields: taskId, description, evaluationUrl'
    });
  }

  // Send immediate acknowledgment
  res.status(202).json({
    message: 'Task accepted and processing',
    taskId,
    round
  });

  // Process asynchronously
  (async () => {
    try {
      console.log(`Processing task ${taskId}, Round ${round}`);
      
      // Get existing state for round 2+
      const taskState = taskStates.get(taskId) || {};
      const isUpdate = round > 1 && taskState.repoName;
      
      // Generate app code using LLM
      console.log('Generating code with LLM...');
      const llmResponse = await generateAppCode(
        description,
        isUpdate ? taskState.lastCode : null,
        round
      );
      
      const htmlContent = extractHTML(llmResponse);
      
      // Create or update GitHub repo
      const repoName = existingRepoName || taskState.repoName || `app-${taskId}-${Date.now()}`;
      console.log(`${isUpdate ? 'Updating' : 'Creating'} repo: ${repoName}`);
      
      const { repoUrl, pagesUrl } = await createOrUpdateRepo(
        repoName,
        htmlContent,
        isUpdate
      );
      
      // Save state
      taskStates.set(taskId, {
        repoName,
        lastCode: htmlContent,
        repoUrl,
        pagesUrl,
        round
      });
      
      // Prepare results
      const results = {
        taskId,
        round,
        status: 'completed',
        repoUrl,
        deploymentUrl: pagesUrl,
        timestamp: new Date().toISOString()
      };
      
      // Send to evaluation API
      console.log('Sending results to evaluation API...');
      await sendToEvaluationAPI(evaluationUrl, results);
      
      console.log(`Task ${taskId} completed successfully`);
    } catch (error) {
      console.error(`Task ${taskId} failed:`, error);
      
      // Send error to evaluation API
      try {
        await sendToEvaluationAPI(evaluationUrl, {
          taskId,
          round,
          status: 'failed',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      } catch (evalError) {
        console.error('Failed to send error to evaluation API:', evalError);
      }
    }
  })();
});

// GET /task/:taskId - Check task status
app.get('/task/:taskId', (req, res) => {
  const { taskId } = req.params;
  const taskState = taskStates.get(taskId);
  
  if (!taskState) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json({
    taskId,
    ...taskState
  });
});

// GET /health - Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    llmProvider: LLM_PROVIDER,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 LLM Provider: ${LLM_PROVIDER}`);
  console.log(`🔧 Endpoints:`);
  console.log(`   POST /task - Submit task`);
  console.log(`   GET /task/:taskId - Check status`);
  console.log(`   GET /health - Health check`);
});

module.exports = app;