// frontend/scripts/request.js
document.getElementById('requestForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const residentName = document.getElementById('residentName').value;
    const requestType = document.getElementById('requestType').value;

    const response = await fetch('http://localhost:3000/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentName, requestType })
    });

    const data = await response.json();
    alert(data.message || "Request submitted successfully!");
});
