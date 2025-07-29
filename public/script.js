// DOM Elements
const body = document.querySelector("body"),
      modeToggle = body.querySelector(".mode-toggle"),
      sidebar = body.querySelector("nav"),
      sidebarToggle = body.querySelector(".sidebar-toggle");

// Dark Mode Toggle
let getMode = localStorage.getItem("mode");
if(getMode && getMode ==="dark"){
    body.classList.toggle("dark");
}

// Sidebar Toggle
let getStatus = localStorage.getItem("status");
if(getStatus && getStatus ==="close"){
    sidebar.classList.toggle("close");
}

modeToggle.addEventListener("click", () =>{
    body.classList.toggle("dark");
    localStorage.setItem("mode", body.classList.contains("dark") ? "dark" : "light");
});

sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("close");
    localStorage.setItem("status", sidebar.classList.contains("close") ? "close" : "open");
});

// PWA Installation Prompt
let deferredPrompt;
const installBtn = document.getElementById('installBtn');
const installContainer = document.getElementById('installContainer');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installContainer.style.display = 'block';
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installContainer.style.display = 'none';
    }
    deferredPrompt = null;
  }
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registered:', registration.scope);
      })
      .catch(err => {
        console.log('ServiceWorker registration failed:', err);
      });
  });
}

// Notification Handler
function showNotification(message, type = 'info') {
  if (Notification.permission === 'granted') {
    new Notification('BTMS Notification', { 
      body: message,
      icon: '/icons/icon-192x192.png'
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification('BTMS Notification', { 
          body: message,
          icon: '/icons/icon-192x192.png'
        });
      }
    });
  }
  
  // Fallback toast notification
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Socket.IO Connection
const socket = io({ withCredentials: true });

socket.on('new_announcement', (announcement) => {
  showNotification(`New announcement: ${announcement.title}`);
  if (window.location.pathname.includes('residentdashboard.html')) {
    updateAnnouncementCount();
  }
});

socket.on('emergencyResponse', (response) => {
  if (response.residentId === localStorage.getItem('userId')) {
    showEmergencyResponse(response.message);
  }
});

function showEmergencyResponse(message) {
  const notification = document.createElement('div');
  notification.className = 'emergency-notification';
  notification.innerHTML = `
    <div class="emergency-content">
      <i class="uil uil-bell"></i>
      <div>
        <h4>Emergency Response</h4>
        <p>${message}</p>
      </div>
    </div>
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'fadeOut 0.5s forwards';
    setTimeout(() => notification.remove(), 500);
  }, 10000);
}

// Update announcement count
async function updateAnnouncementCount() {
  try {
    const response = await fetch('/api/announcements/user', { credentials: 'include' });
    if (response.ok) {
      const announcements = await response.json();
      const viewed = JSON.parse(localStorage.getItem('viewedAnnouncements')) || [];
      const newCount = announcements.filter(a => 
        !viewed.includes(a._id) && 
        new Date(a.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      ).length;
      
      const counter = document.getElementById('newAnnouncements');
      if (counter) counter.textContent = newCount;
    }
  } catch (error) {
    console.error('Failed to update announcements:', error);
  }
}

// Check authentication status
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/check-auth', { credentials: 'include' });
    if (!response.ok) {
      window.location.href = 'index.html';
    }
  } catch (error) {
    window.location.href = 'index.html';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Check auth for protected pages
  if (!window.location.pathname.includes('index.html')) {
    checkAuth();
  }
  
  // Set up logout button if exists
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/auth/logout', { 
          method: 'POST',
          credentials: 'include'
        });
        localStorage.clear();
        window.location.href = 'index.html';
      } catch (error) {
        console.error('Logout error:', error);
      }
    });
  }
});