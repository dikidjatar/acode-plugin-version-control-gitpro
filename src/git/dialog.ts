const DialogBox = acode.require('DialogBox');

class MessageItem {
  constructor(readonly label: string) { }
}

export function item(label: string): MessageItem {
  return new MessageItem(label);
}

const style = `display:flex;
justify-content:center;
align-items:center;
padding:8px;
width:100%;
box-sizing:border-box;
color:var(--primary-text-color);
border-radius:4px;border: 2px solid var(--border-color);
cursor:pointer;
font-size:1em;`;

export function showDialogMessage(title: string, message: string, ...items: MessageItem[]): Promise<MessageItem | undefined> {
  const cancelButton = new MessageItem(items.length > 0 ? 'Cancel' : 'Ok');
  const content: string[] = [];

  content.push(`<div>${message}</div>`);
  content.push(`<div style="width: 100%; height: 100%; padding: 10px 0;">`);

  if (items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      content.push(
        `<div style="display: flex; justify-content: center; align-items: center; width: 100%; min-height: 26px; padding: 2px 0;">
					<span class="text" data-index="${i}" style="${style}">${items[i].label}</span>
				</div>`
      );
    }
  }

  content.push(
    `<div style="display: flex; justify-content: center; align-items: center; width: 100%; min-height: 26px; padding: 2px 0;">
			<span class="text" data-index="-1" style="${style}">${cancelButton.label}</span>
		</div>`
  );
  content.push('</div>');

  return new Promise<MessageItem | undefined>((c) => {
    const box: Acode.DialogBox = (DialogBox as any)(title, content.join(''), true)
      .onclick((e: globalThis.Event) => {
        const target = e.target as HTMLElement | null;

        if (!target) {
          return;
        }

        const rawIndex = target.dataset.index;
        const index = Number(rawIndex);

        if (isNaN(index)) {
          return;
        }

        if (index === -1) {
          box.hide();
          return c(undefined);
        }

        box.hide();
        return c(items[index]);
      })
      .onhide(() => c(undefined));
  });
}