---
status: closed
resolution: crossed mic on the band when offline or without wheel buttons, and on list rows the buttons cannot drive
id: qa-20261122-r4-09
title: The mic mark stays plain while OFFLINE says "voice input will not work" and while NO BUTTONS is shown
severity: minor
area: view (band mic mark)
how to reproduce: dev server, selected revview session, POST `RevviewInput {present:false}` then `RevviewNetwork {online:false}`
evidence: /tmp/qa-wb4-shots/s7-01-no-buttons-tag.png, /tmp/qa-wb4-shots/s7-02-offline.png, /tmp/qa-wb4-shots/s7-03-list-offline.png
---

## Steps

1. `alpha-service` selected (DONE, 1/8).
2. POST `{"hook_event_name":"RevviewInput","present":false}` (accepted under `--dev-bridge`): NO BUTTONS tag.
3. POST `{"hook_event_name":"RevviewNetwork","online":false}`: OFFLINE.

## What I saw

The band shows `✕ OFFLINE ▲+7 🎤 1/8 alpha-service [NO BUTTONS]` and the first row says "No network: voice input
will not work". The mic mark is the plain "push-to-talk reaches this session" glyph, while the text under it says
voice will not work and the tag says there are no buttons to press. Two signals in one glance that disagree.

## What I expected

The mic mark answers "what happens if I press push-to-talk now". Offline or with no buttons the answer is
"nothing useful", so a crossed (or otherwise marked) mic, or no mic, would agree with the rest of the bar.
