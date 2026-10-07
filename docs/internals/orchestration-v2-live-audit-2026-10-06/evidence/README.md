# Live screenshot evidence

Captured from the actual running apps on October 6, 2026. Test Rig uses the disposable two-import launch workaround described in the main report. Screenshots show individual states, not exhaustive lifecycle proof. Native screenshots can have different window dimensions; this is a functional comparison, not a pixel-difference benchmark.

| Case                                   | Test Rig                                                     | T3 Code nightly                                                           |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Read-only native child                 | [Test Rig](test-rig-native-child.png)                        | [.2735](nightly-native-child.png)                                         |
| Structured question collapse           | [Expanded](test-rig-question.png)                            | [.2735 collapsed](nightly-question-collapsed.png)                         |
| CSV and ignored directory              | [Raw CSV](test-rig-files-csv.png)                            | [.2735 table + ignored directory](nightly-files-csv.png)                  |
| Context controls                       | [Read-only gauge](test-rig-compact-read-only.png)            | [.2735 compact with preserved draft](nightly-compact-draft-preserved.png) |
| App-owned result                       | [Generic row](test-rig-app-child-completion.png)             | [.2735 named card](nightly-app-child-completion.png)                      |
| Final schedule result view             | [Test Rig](test-rig-final.png)                               | [.2752](nightly-final.png)                                                |
| Browser reload after worktree/approval | [Restored browser conversation](test-rig-browser-reload.png) | Not repeated in a nightly browser                                         |

The scheduled-task screenshots show completed manual runs; both schedules remain disabled. No pairing token is retained in these screenshots.
