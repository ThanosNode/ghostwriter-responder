const emailInput = document.getElementById('email');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

chrome.storage.local.get(['ghostwriter_email'], function(result) {
  if (result.ghostwriter_email) {
    emailInput.value = result.ghostwriter_email;
    showStatus('Email saved', 'success');
  }
});

saveBtn.addEventListener('click', function() {
  var email = emailInput.value.trim();
  if (!email || email.indexOf('@') === -1) {
    showStatus('Please enter a valid email.', 'error');
    return;
  }
  chrome.storage.local.set({ ghostwriter_email: email }, function() {
    showStatus('Saved! Ready to use GhostWriter.', 'success');
  });
});

emailInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') saveBtn.click();
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
}
