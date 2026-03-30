document.addEventListener('DOMContentLoaded', function () {
  var testButton = document.getElementById('testButton');

  if (testButton) {
    testButton.addEventListener('click', function () {
      alert('Test button clicked');
    });
  }
});