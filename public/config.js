window.DRESSCODE_CONFIG = {
  // Leave blank when the frontend and Node server share the same origin.
  // For GitHub Pages, set this to the deployed Node backend, for example:
  // apiBaseUrl: 'https://dresscode-api.example.com'
  apiBaseUrl: ''
};

window.addEventListener('DOMContentLoaded', () => {
  import('./js/payments-ui.js').catch(error => console.error('Unable to load payments UI:', error));
});
