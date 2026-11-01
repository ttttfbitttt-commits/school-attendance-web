// Keep the live assistant and its microphone handlers when a dialog redraws.
export function setDialogContent(dialog,markup){
 const assistant=dialog.querySelector(':scope > .assistant');
 if(assistant)assistant.remove();
 dialog.innerHTML=markup;
 if(assistant)dialog.prepend(assistant);
}
