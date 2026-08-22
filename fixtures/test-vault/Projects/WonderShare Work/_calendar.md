---
title: WonderShare Work
calendar-view: true
calendar-recursive: true
calendar-start-property: date
calendar-end-property: date-end
calendar-visible-properties:
  - status
  - type
  - important
calendar-properties:
  status:
    type: select
    options:
      - None
      - Not started
      - Blocked
      - In progress
      - Abandoned
      - Done
    colors:
      None: default
      Not started: gray
      Blocked: red
      In progress: blue
      Abandoned: yellow
      Done: green
    default: Not started
  type:
    type: select
    options:
      - None
      - Task
      - Learn
      - Idea
    colors:
      None: default
      Task: blue
      Learn: green
      Idea: purple
    default: Task
  important:
    type: checkbox
    default: false
calendar-card-color-property: status
calendar-week-starts-on: monday
calendar-layout: month
calendar-open-behavior: same-leaf
---

Fixture calendar for manual P0 smoke testing.
