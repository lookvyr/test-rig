# HTML visualizations

Ask your agent for an interactive chart, table, diagram, or small HTML dashboard. The agent can preview a page first, inspect its screenshot, console messages, and measured height, then publish the finished page directly into the conversation. It stays visible when the surrounding tool activity is collapsed.

Visualizations follow your current theme and fonts. Buttons, sliders, and other page controls work inside the conversation. Select **Expand** above a visualization for a larger view. Zoom from 50% to 200%, or select the percentage to reset to 100%. Close the viewer or press Escape to return to the conversation. Your inputs and other interactive state stay with the page when expanding and closing; each expansion starts at 100% zoom.

Increasing zoom above 100% automatically turns on the **Hand tool**. Drag to pan the zoomed view in any direction with a mouse. Turn the Hand tool off to select text, follow links, or use the page's controls; turn it back on to pan again. For long pages, turn Hand off to scroll inside the HTML content. Returning to 100% or resetting zoom turns it off.

The expanded viewer hides its scrollbars. You can still scroll in either direction with a trackpad or scroll wheel.

Select **Open in panel** to open a separate copy in a side-panel tab, with HTML source and download controls. Both actions stay outside the page so they cannot cover its content or controls.

Each published page is saved with its conversation and survives reloading the app. Changes made with the page's controls are temporary and reset when that page reloads. Local images are embedded when the page is published; external resources still require a network connection.

Pages run in an isolated frame without access to your app session or storage. Links open outside the visualization. Pages adapt to the available width so narrower windows can show taller layouts without trapping your scroll. The agent can still request a shorter frame for long content, and frames never exceed 2,000 pixels. Older pages and pages published without measurements use the agent’s requested height as their cap.

Previews run on the server, so they work without an open desktop window. The first preview downloads a verified Chromium build into Test Rig’s own data directory. If installation takes longer than a tool call, the agent receives progress and can retry. Missing host libraries or sandbox support produce setup instructions.

A preview uses a fresh browser profile, with no app cookies or saved logins. It can load public resources but cannot read arbitrary local files or contact services on your private network. Referenced local images are embedded before rendering. Preview screenshots are feedback for the agent; the published visualization remains interactive.

Keyboard focus outlines stay inside controls so they remain visible at the frame edges.

Opening a visualization uses a gently pulsing placeholder followed by a short fade-in. When switching to HTML source, the rendered page stays visible while the source loads. Reduced-motion preferences disable the pulse and fade.
