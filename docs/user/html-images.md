# Images in rendered HTML

Click a standalone image inside rendered HTML to open Test Rig's image viewer.
Images inside links or buttons keep their page action. Modified clicks also keep
the page's behavior. The viewer supports the existing zoom, pan, copy, and save
controls.

The viewer works in inline HTML, expanded HTML, and the side panel. Expanded HTML
keeps its original iframe, including form values and page state. Closing an image
returns to that page; Escape closes an open image menu first, then the image,
then the expanded HTML. The HTML's existing zoom and Hand tool remain available.

Only a focused, active HTML frame can request the viewer through the sandbox
bridge. Image requests accept HTTP, HTTPS, and image data URLs; file URLs and
script URLs are rejected.
