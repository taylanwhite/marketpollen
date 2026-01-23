// Quick test script to check if endpoints are working
import axios from 'axios';

const baseUrl = 'https://postsplenic-stockish-debroah.ngrok-free.dev';

async function test() {
  try {
    console.log('Testing get-calendar-events...');
    const response = await axios.post(`${baseUrl}/api/get-calendar-events`, {
      date: '2026-01-19',
      storeName: 'Downtown Location'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('Success:', response.status, response.data);
  } catch (error) {
    console.error('Error:', error.response?.status, error.response?.data || error.message);
  }
}

test();
