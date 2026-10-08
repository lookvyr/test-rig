# Browser

Press Command-T in an active task to open a new browser tab and focus its address
bar. Existing tabs stay open. This also works with the terminal focused unless
you have assigned that shortcut to another command in your terminal keybindings.

Command-W closes the active tab in the right panel, including browsers, reviews,
files, and side chats. Closing the last tab hides the panel. If the panel is open
with no tabs, Command-W hides it. When a terminal is focused, Command-W closes
that terminal instead. On Windows and Linux, use Ctrl in place of Command.

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

## Browsing from the web app

Browser tabs in the web app run on the connected environment. A `localhost`
address reaches a service on that environment, and the page keeps running when
you reload or disconnect the web app. Reconnecting resumes the same page.
Closing its browser tab ends the page.

Click, type, scroll, navigate, and answer page dialogs from the right panel.
The browser menu includes zoom, appearance, device sizes, and storage controls.
When a page downloads a file, choose **Save** in the notification to save it to
your device. File pickers send the files you select to the environment's page.

Server browser views currently stream images without sound. Native desktop
browser tabs retain their sound, context menus, DevTools, and separate preview
windows.

## Agent inspection and screenshots

The agent cursor shows where the agent is interacting with the page, without
control badges. Clicking or typing in the browser does not interrupt agent
actions. Use the chat’s Stop control when you want to stop the agent.

Ask the agent to inspect a page in Test Rig's integrated browser. Its snapshot
includes page text, interactive elements, recent diagnostics, and an image.
Large snapshots report which details were omitted so the agent can inspect a
specific part of the page next.

The agent can request text-only snapshots when it does not need an image, or save
a screenshot as evidence. Saved screenshots can appear directly in the reply and
remain available after the browser navigates or closes. They stay in Test Rig's
local data directory; saving them does not add files to your repository.

When no desktop browser is available, agents can use the environment's server
browser without an open web client. Agent sessions use isolated browser storage;
they do not inherit your named profile's logins. A session stays on its assigned
browser when another client connects. You can interact with an agent's revealed
page while its actions run in order with yours.

## Profiles and sound

Create named browser profiles in **Settings → General →
Browser profiles** to keep separate cookies and logins. Choose a profile when
opening a browser from the panel's add menu. The Default profile keeps your
existing browser session. Incognito uses temporary storage. Server profiles are
stored on their environment, separately from desktop profiles. Server profile
logins survive server restarts; open pages do not.

**Clear profile data** in a server browser's menu closes that profile's tabs and
removes its saved storage. It is unavailable for isolated agent and Incognito tabs.

Use a native desktop browser tab's context menu to **Mute tab** or **Unmute tab**. These controls
change that tab's sound without muting the whole app.

**Cmd+Shift+T** on macOS or **Ctrl+Shift+T** elsewhere reopens a closed browser view
with its saved profile and viewport. Incognito tabs can reopen during the current session, but their closed-view
history is not saved across reloads.

## Private sign-in values

When an agent needs a password or token for a browser task, it can request a
private card in chat. Enter the value in the masked field and choose **Save
privately**, or choose **Decline**. Saved and declined cards collapse to a compact
outcome row. Stopping the agent ends an unanswered request.

The value goes to the connected environment's secret store. Chat records contain
only the request and its status; the agent receives a reference that can be used
once to fill a specific browser tab and field. Input is preserved exactly,
including spaces. Unused values expire after 24 hours and are cleaned up hourly.
A failed browser entry may require a fresh request.

The destination page receives the value. This does not prevent the page—or an
agent subsequently reading that page—from accessing it. The private card keeps
the entry and transfer out of chat; it is not a password vault.

## Tool screenshots in chat

Expand a tool call to see raster images it returned, including browser and MCP
screenshots. Select an image to enlarge it. A tool result can show up to eight
images; oversized images are unavailable. Images read from local files continue
to use the file preview.
