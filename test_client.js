// test-client.js
// Example client to test the API

const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';

// Mock evaluation API endpoint (you'll replace this with the real one)
const EVALUATION_API_URL = 'https://webhook.site/your-unique-url';

async function testRound1() {
  console.log('🧪 Testing Round 1: Initial App Creation\n');
  
  const taskId = `task-${Date.now()}`;
  
  const request = {
    taskId: taskId,
    description: 'Create a simple todo list app with the ability to add, complete, and delete tasks. Use a modern, colorful design with smooth animations.',
    evaluationUrl: EVALUATION_API_URL,
    round: 1
  };
  
  try {
    const response = await axios.post(`${API_BASE_URL}/task`, request);
    console.log('✅ Round 1 Response:', response.data);
    console.log(`\n⏳ Task submitted. Check status at: ${API_BASE_URL}/task/${taskId}`);
    
    // Wait and check status
    setTimeout(async () => {
      try {
        const status = await axios.get(`${API_BASE_URL}/task/${taskId}`);
        console.log('\n📊 Task Status:', status.data);
      } catch (err) {
        console.log('Status check:', err.response?.data || err.message);
      }
    }, 5000);
    
    return taskId;
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

async function testRound2(taskId, repoName) {
  console.log('\n🧪 Testing Round 2: App Update\n');
  
  const request = {
    taskId: taskId,
    description: 'Add a dark mode toggle button and make the app responsive for mobile devices. Add local storage to persist tasks.',
    evaluationUrl: EVALUATION_API_URL,
    round: 2,
    repoName: repoName
  };
  
  try {
    const response = await axios.post(`${API_BASE_URL}/task`, request);
    console.log('✅ Round 2 Response:', response.data);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

async function checkHealth() {
  try {
    const response = await axios.get(`${API_BASE_URL}/health`);
    console.log('🏥 Health Check:', response.data);
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
  }
}

// Run tests
(async () => {
  console.log('🚀 Starting API Tests\n');
  console.log('=' .repeat(50) + '\n');
  
  await checkHealth();
  console.log('\n' + '='.repeat(50) + '\n');
  
  const taskId = await testRound1();
  
  // Uncomment below to test Round 2 after Round 1 completes
  // You'll need to provide the actual repoName from Round 1
  /*
  setTimeout(() => {
    testRound2(taskId, 'app-task-1234567890');
  }, 60000); // Wait 60 seconds for Round 1 to complete
  */
})();