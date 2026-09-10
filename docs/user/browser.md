# Browser

Press Command-T in an active task to open a new browser tab and focus its address
bar. Existing tabs stay open. This also works with the terminal focused unless
you have assigned that shortcut to another command in your terminal keybindings.

Command-W closes the active tab in the right panel, including browsers, reviews,
files, and side chats. Closing the last tab hides the panel. When a terminal is
focused, Command-W closes that terminal instead. On Windows and Linux, use Ctrl
in place of Command.

Enter a website address or search terms in the browser's address bar, then press
Enter. Search terms open Google results in the current tab. Searches are sent
only when you submit them; typing does not request search suggestions.

Addresses such as `example.com` and `localhost:3000` open directly. For a
single-word internal hostname, include `http://` or `https://` to distinguish it
from a search. Invalid addresses show an error and remain in the address bar so
you can correct them.

In the desktop app, right-click inside a browser tab to open its native context
menu. Cut, Copy, Paste, and Select All are available when the clicked page allows
them. The menu also offers Copy Link for supported links, Copy Image for images,
and spelling suggestions for misspelled words in editable text.

Clipboard and spelling actions apply to the clicked page, including embedded
frames.

## Agent inspection and screenshots

Ask the agent to inspect a page in Test Rig's integrated browser. Its snapshot
includes page text, interactive elements, recent diagnostics, and an image.
Large snapshots report which details were omitted so the agent can inspect a
specific part of the page next.

The agent can request text-only snapshots when it does not need an image, or save
a screenshot as evidence. Saved screenshots can appear directly in the reply and
remain available after the browser navigates or closes. They stay in Test Rig's
local data directory; saving them does not add files to your repository.
