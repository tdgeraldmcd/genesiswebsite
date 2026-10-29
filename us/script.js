const dialog = document.querySelector('#preview-dialog');
const message = document.querySelector('#dialog-message');
document.querySelector('.purchase').addEventListener('click', () => {
  message.textContent = 'In the finished flow, this button will request the $97 USD one-time purchase, then take the buyer to the Cash Flow Content Accelerator offer after payment succeeds. No payment has been taken in this preview.';
  dialog.showModal();
});
document.querySelector('.decline').addEventListener('click', () => {
  message.textContent = 'In the finished flow, this will open the $47 webinar offer without Q&A. That page will be built after this page is reviewed. No purchase or navigation has occurred.';
  dialog.showModal();
});
document.querySelectorAll('.dialog-close, .dialog-done').forEach(button => {
  button.addEventListener('click', () => dialog.close());
});
