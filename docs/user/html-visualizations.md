# HTML visualizations

Ask your agent for an interactive chart, table, diagram, or small HTML dashboard. The agent can preview a page first, inspect its screenshot, console messages, and measured height, then publish the finished page directly into the conversation. It stays visible when the surrounding tool activity is collapsed.

Visualizations follow your current theme and fonts. Buttons, sliders, and other page controls work inside the conversation. Hover over a visualization and select **Open in panel** to view it in a side-panel tab. The panel also offers HTML source and download controls.

Each published page is saved with its conversation and survives reloading the app. Changes made with the page's controls are temporary and reset when that page reloads. Local images are embedded when the page is published; external resources still require a network connection.

Pages run in an isolated frame without access to your app session or storage. Links open outside the visualization. The agent chooses a maximum inline height; longer pages scroll within that frame.

Previews run on the server, so they work without an open desktop window. The first preview downloads a verified Chromium build into Test Rig’s own data directory. If installation takes longer than a tool call, the agent receives progress and can retry. Missing host libraries or sandbox support produce setup instructions.

A preview uses a fresh browser profile, with no app cookies or saved logins. It can load public resources but cannot read arbitrary local files or contact services on your private network. Referenced local images are embedded before rendering. Preview screenshots are feedback for the agent; the published visualization remains interactive.

Opening a visualization uses a gently pulsing placeholder followed by a short fade-in. When switching to HTML source, the rendered page stays visible while the source loads. Reduced-motion preferences disable the pulse and fade.
