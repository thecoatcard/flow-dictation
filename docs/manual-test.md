# Manual test checklist

For the exact words to say and what to expect for every feature, see the [testing guide](testing-guide.md).

## Floating icon and Windows setup

- [ ] Idle icon fades after five seconds and stops intercepting clicks
- [ ] Dictation hotkey reveals the icon immediately; listening and processing stay visible
- [ ] Hovering or dragging defers the fade; dragged position persists after restart
- [ ] Setup exe opens an installation wizard, installs to the chosen folder, creates shortcuts, and uninstalls cleanly

Launch: `$env:GEMINI_API_KEY="..."; pnpm dev`. Hold right Ctrl (right Option on macOS), speak, release.

- [ ] Insert into Notepad / TextEdit
- [ ] Insert into a browser textbox
- [ ] Insert into VS Code
- [ ] Insert into a chat app and an email client
- [ ] Clipboard restored afterwards (text), and with an image on the clipboard
- [ ] Overlay shows Listening -> Processing -> Done and never steals focus
- [ ] Long dictation (~60 s)
- [ ] Silence-only press inserts nothing
- [ ] Rapid double-press does not double-insert or get stuck
- [ ] Mic unplugged mid-session shows an error and recovers
- [ ] No network shows an error, inserts nothing
- [ ] Wrong API key shows an error, inserts nothing
- [ ] "delete that" removes the last insertion
- [ ] Command Mode: select a paragraph, hold Ctrl+Alt+E, say "make this shorter"; the selection is replaced. With nothing selected it says "Select some text first"
- [ ] Record shortcut: Ctrl+Alt+D is saved as a custom hotkey; holding it records, and the same key alone or with other modifiers does nothing
- [ ] Sound cues: a rising two-note chime once the mic is live (speak after it) and a falling one when recording stops; Settings > Dictation > Sound cues has a Play button and an off switch
- [ ] Mute while dictating: music goes quiet after the start tone and comes back when you stop; if it was already muted, it stays muted
- [ ] "select all", "undo", "press enter", "press tab" and "press escape" press that key when they are the whole utterance
- [ ] "reply sounds good press enter" inserts the text, then presses Enter
- [ ] Tray "Copy last dictation" works
- [ ] Per-stage timings appear in `%APPDATA%/@flow/desktop/flow-debug.log` (no transcripts)

## M5 personalization

- [ ] Dictate into Slack/Teams, an email client and VS Code after assigning casual / professional / code: same sentence comes out in three tones
- [ ] Recently used apps appear in the "Tone per app" list
- [ ] A dictionary term (e.g. Spring Boot) is spelled exactly
- [ ] A snippet trigger ("my email") expands verbatim; "new paragraph" inserts a blank line
