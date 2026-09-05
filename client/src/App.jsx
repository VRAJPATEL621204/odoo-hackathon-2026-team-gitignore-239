import { useState, useEffect } from 'react';

export default function App() {
  const [dbStatus, setDbStatus] = useState('connecting...');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setDbStatus(data.db || 'connected');
      })
      .catch((err) => {
        console.error('Healthcheck failed:', err);
        setDbStatus('failed to connect');
      });
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Welcome</h1>
      <p>Backend says: {dbStatus}</p>
    </div>
  );
}
