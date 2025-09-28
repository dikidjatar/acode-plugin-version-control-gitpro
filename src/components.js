const DialogBox = acode.require('dialogBox');

/**
 * @param {Array<string>} untrackedFiles 
 * @param {Array<string>} modifiedFiles 
 * @returns {Promise<boolean>}
 */
export async function confirmDiscardChanges(untrackedFiles, modifiedFiles) {
  return await new Promise((resolve, reject) => {
    const untrackedCount = untrackedFiles.length;
    const modifiedCount = modifiedFiles.length;
    let msg = '';

    if (untrackedCount > 0) {
      msg += 'Are you sure you want to DELETE ';
      if (untrackedCount === 1) {
        msg += `the following untracked file: '${untrackedFiles[0]}'`;
      } else {
        msg += `the ${untrackedCount} untracked files? `;
        msg += 'This action cannot be undone.';
      }
      if (modifiedCount > 0) {
        msg += '</br></br>';
      }
    }

    if (modifiedCount > 0) {
      msg += 'Are you sure you want to discard ';
      if (modifiedCount === 1) {
        msg += `changes in '${modifiedFiles[0]}'?`;
      } else {
        msg += `ALL changes in ${modifiedCount} files?`;
        msg += '</br></br>';
        msg += 'This is IRREVERSIBLE!';
        msg += '</br>';
        msg += 'Your current working set will be FOREVER LOST if you proceed';
      }
    }

    let confirmButtonText = 'continue';
    if (untrackedCount > 0 && modifiedCount > 0) {
      /** ignore */
    } else if (untrackedCount > 0) {
      if (untrackedCount === 1) {
        confirmButtonText = 'delete';
      } else {
        confirmButtonText = `delete (${untrackedCount}) files`;
      }
    } else if (modifiedCount > 0) {
      if (modifiedCount === 1) {
        confirmButtonText = 'discard';
      } else {
        confirmButtonText = `discard (${modifiedCount}) files`;
      }
    }

    try {
      const box = DialogBox('Warning', msg, confirmButtonText, 'cancel');
      box.cancel(() => { box.hide(); resolve(false) });
      box.ok(() => { box.hide(); resolve(true) });
      box.onhide(() => resolve(false));
    } catch (error) {
      reject(error);
    }
  });
}