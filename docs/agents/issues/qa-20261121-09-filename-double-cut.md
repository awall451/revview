---
id: qa-20261121-09
title: Long file names are cut twice ("…eForTheSet…PanelController.test.tsx"): the state core drops the start of the name before the view's middle cut
severity: minor
area: state, view
how to reproduce: |
  POST PreToolUse Edit with file_path
  `/home/user/src/revview/deeply/nested/.../AVeryLongComponentNameForTheSettingsPanelController.test.tsx`
  (cwd /home/user/src/revview).
evidence: |
  Emulator line 2: `Edit …eForTheSet…PanelController.test.tsx`, data-full is already
  `…eForTheSettingsPanelController.test.tsx`: `shortenPath` (40 code points) keeps only the last 39
  characters of the name, then `middleEllipsis` cuts that again. src/view/README says "only if the file
  name alone does not fit is it cut in its own middle, about a third from the front", which the view
  cannot do because the front is gone. Two ellipses in one name look like corruption. Either the state
  core passes the whole relative path (the view already fits it to real pixels) or it cuts the same way.
---
