# Browser

Press Command-T in an active task to open a new browser tab and focus its address
bar. Existing tabs stay open. This also works with the terminal focused unless
you have assigned that shortcut to another command in your terminal keybindings.

Links that open a new tab, including `target="_blank"` links and direct
`window.open(url)` requests, open another integrated browser tab in the same task
and browser profile. The original page stays open.

Command-W closes the active tab in the right panel, including browsers, reviews,
files, and side chats. Closing the last tab hides the panel. If the panel is open
with no tabs, Command-W hides it. When a terminal is focused, Command-W closes
that terminal instead. On Windows and Linux, use Ctrl in place of Command.

With the right panel open, **Command-Shift-F** toggles full view while keeping the
left sidebar visible. Press it again to restore the panel width. On Windows and
Linux, use Ctrl instead of Command.

Enter a website address or search terms in the browser's address bar, then press
Enter. Search terms open results from Google in the current tab. To use
DuckDuckGo, Bing, Brave Search, Kagi, Ecosia, or your own search address, choose it in
**Settings → General → Browser search**. A custom address must contain `%s`
where the search terms go. Searches are sent only when you submit them; typing
does not request search suggestions.

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

## Annotating a PDF

In a native desktop browser tab, choose **Annotate** to mark a PDF. Annotation
starts with **Region**; use **Draw** for freehand marks. The annotation shortcuts
and **Escape** work even after clicking into the PDF viewer. Ending annotation
restores normal PDF interaction. Attach sends the annotated screenshot and your
comment to the composer; it does not edit the original PDF. Streamed browser
tabs do not offer annotation.

## Where browser tabs run

Browser tabs belong to the environment, so you and your agents see the same tabs
from every window and device. The desktop app shows its own environment's tabs
directly, with their sound, context menus, DevTools, and separate preview
windows. The web app, and the desktop app for any other environment, streams
them from that environment. A `localhost` address reaches a service on the
environment, and a page keeps running when you reload or disconnect. Reconnecting
resumes the same page. Closing its browser tab ends the page.

## Browsing from the web app

Click, type, scroll, navigate, and answer page dialogs from the right panel.
The browser menu includes zoom, appearance, device sizes, and storage controls.
When a page downloads a file, choose **Save** in the notification to save it to
your device. File pickers send the files you select to the environment's page.

Server browser views currently stream images without sound. Native desktop
browser tabs retain their sound, context menus, DevTools, and separate preview
windows.

## Agent inspection, screenshots, and recordings

The agent cursor shows where the agent is interacting with the page, without
control badges. Clicking or typing in the browser does not interrupt agent
actions. Use the chat’s Stop control when you want to stop the agent.

Agents use the integrated browser when you ask for browser work, such as
checking a page or a flow. They don't open it on their own to check an edit, and
they close tabs they opened before replying unless you're using them.

A snapshot gives the agent the page text and the page's controls, each with a
reference it can click or type into. It also lists console errors and failed
requests that happened since the agent's previous snapshot. Large snapshots
report which details were omitted so the agent can inspect a specific part of
the page next.

Snapshots don't include an image unless the agent asks to see the page. The agent
can also save a full-size screenshot as evidence. Saved screenshots can appear directly in the reply and
remain available after the browser navigates or closes. They stay in Test Rig's
local data directory; saving them does not add files to your repository.

Ask the agent to record a walkthrough when you want to review a browser flow.
It can start recording, interact with the page, and include a playable video in
its reply. Recordings capture the page without sound. For a desktop walkthrough,
ask for a desktop viewport; mobile and responsive checks can keep their chosen
device size.

Saved recordings remain available after the browser closes. When the browser
runs on another machine, the recording is transferred to the agent's environment
before it is presented. Recording transfers support files up to 50 MiB.

Images have bounded previews with expand and download icons; hover over an icon
to see its action. Videos use the available message width while keeping their
original proportions and a bounded height. Use the player's built-in controls
for playback, seeking, downloads, and fullscreen.

Agents drive the same browser tabs you see. In the desktop app, a tab an agent
opens appears in the browser panel and the agent acts on that page directly,
using the tab's profile. When the desktop app is not running, agents keep working
in the environment's own headless browser. There, agent tabs use your default
browser profile's saved logins, or the profile the agent picks; choose the
Incognito profile for a tab with no saved data. Agents need no open window either
way.

You can click and type in a page while an agent works on it; nobody takes
exclusive control. In a streamed tab, your input and the agent's actions run in
order, and the agent takes a fresh snapshot of the page after you interact. Use
the chat's Stop control when you want the agent to stop.

## Local servers

The browser's empty state lists servers that your terminals and agents started,
by the port they listen on. Test Rig reads which process holds each port and
does not connect to it, so a listed port might not be a web page. Servers started
anywhere else are not listed, except preview URLs from the project's scripts,
which appear while they answer. Choose a server to open it, or **Stop** to end a
server that a terminal or agent in this environment started. Set `TEST_RIG_PORT_DISCOVERY=0` in the environment that
starts Test Rig to stop listing ports.

A thread's details card also has a **Servers** section while that thread's terminals or agent
have a server listening, including a dev server the agent left running after its turn. Select a
server to open it in the browser panel, or Command-click (Ctrl-click on Windows and Linux) to open
it in your own browser. Hover a server and choose **Stop** to end it; the agent, the terminal, and
Test Rig keep running. Stopping needs terminal access to the environment and is not available on
Windows.

## Capture from the desktop browser

Open the browser's capture menu and choose **Screenshot** or **Record video**.
While recording, choose **Stop recording** to save the clip. The control shows
when recording is starting or saving; wait for saving to finish before starting
another capture.

These manual controls apply to native desktop browser tabs. In the web app, ask
the agent to take a screenshot or record a walkthrough.

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
