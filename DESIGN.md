---
name: "GuideAnything"
description: "An adaptive, translucent ERP teaching workspace that keeps complex work calm and legible."
colors:
  light-canvas: "#F5F5F7"
  light-material: "#FCFCFDE0"
  light-material-strong: "#FCFCFDF2"
  light-text: "#1D1D1F"
  light-text-secondary: "#51545E"
  light-separator: "#3C3C4340"
  light-accent: "#0066CC"
  light-accent-pressed: "#004F9E"
  dark-canvas: "#111216"
  dark-material: "#1C1D21E6"
  dark-material-strong: "#24262BF2"
  dark-text: "#F5F5F7"
  dark-text-secondary: "#C7C7CC"
  dark-separator: "#54545D99"
  dark-accent: "#0A84FF"
  dark-accent-pressed: "#409CFF"
  light-success: "#137A3E"
  light-warning: "#8A4B00"
  light-danger: "#B3261E"
  dark-success: "#30D158"
  dark-warning: "#FF9F0A"
  dark-danger: "#FF6961"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "40px"
    fontWeight: 650
    lineHeight: "48px"
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: "34px"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: "18px"
rounded:
  control: "10px"
  surface: "16px"
  sheet: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.light-accent}"
    textColor: "#FBFBFD"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.light-material-strong}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  input-default:
    backgroundColor: "{colors.light-material-strong}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  material-bar:
    backgroundColor: "{colors.light-material}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.surface}"
    padding: "8px 12px"
---

# Design System: GuideAnything

## Overview

**Creative North Star: "The Clear Pane Workspace"**

GuideAnything is a focused work surface, not a dashboard. A process map, a learning step, and a guide title are the primary visual objects. Navigation, inspectors, toolbars, popovers, and status feedback use translucent materials to stay near the work without severing the user from it. This interprets Apple’s material guidance as a functional hierarchy technique, not an invitation to cover the application in frosted cards.

The system is native-feeling but platform-neutral: familiar web controls, one disciplined sans-serif family, generous but not wasteful spacing, and feedback that is immediate rather than theatrical. Light and dark appearances are separate compositions with shared semantic roles. The current product’s forest-green, orange, and editorial-serif vocabulary is replaced rather than blended into this system.

**Key Characteristics:**

- Adaptive light, dark, and system-following appearances, with equal visual quality in both modes.
- Selective material layers that keep the active canvas or lesson visible.
- Dense authoring tools organized by rhythm, grouping, and progressive disclosure.
- A single, calm action color reserved for intent, selection, focus, and progress.
- Familiar, accessible interaction patterns with reduced-motion and higher-contrast fallbacks.

## Colors

The palette uses neutral, subtly cool whites and near-blacks so the teaching content remains the visual subject. The blue action family signals intent rather than brand decoration. Color choices follow the semantic consistency and adaptive-appearance principles in Apple’s [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Color](https://developer.apple.com/design/human-interface-guidelines/color), and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/) guidance.

### Primary

- **Measured Action Blue:** the only default action hue. Use it for the single primary action in a local group, keyboard focus, selected navigation, active step progress, and explicit links.
- **Pressed Action Blue:** use only while the primary control is pressed or active. Do not use it as a second accent.

### Neutral

- **Paper Canvas / Night Canvas:** the base backgrounds for the two appearances. Neither is pure white or pure black.
- **Context Material / Strong Context Material:** translucent layers for navigation, toolbars, inspectors, popovers, and modal sheets. The stronger material is the fallback wherever content behind the layer would compromise legibility.
- **Primary and Secondary Text:** high-contrast instructional text and supporting metadata. Secondary text is never used for essential instructions, validation, or a control’s only label.
- **Separator:** a quiet structural boundary, not a default way to make a card visible.

### Semantic

- **Success:** confirms completed saves, published versions, and completed learning steps; pair it with an icon or plain-language status.
- **Warning:** signals a recoverable decision or incomplete setup; never repurpose it as a decorative highlight.
- **Danger:** marks destructive actions and failures; pair it with an explanation and recovery path.
- **Appearance pairs:** success, warning, and danger each have dedicated light and dark tokens. Do not reuse the low-light text values against the night canvas.

**The Context Material Rule.** Apply blur only when the user needs to see a foreground control while retaining awareness of the content behind it. Guide cards, lesson reading surfaces, node bodies, and form fields stay opaque or nearly opaque.

**The Two-Appearance Rule.** Every semantic color, border, icon, focus ring, and translucent material has a light and dark treatment. Test contrast against the actual backdrop, not a blank swatch; strengthen the material before reducing text contrast.

## Typography

**Display Font:** Inter with the system sans-serif fallback stack.
**Body Font:** Inter with the system sans-serif fallback stack.
**Label/Mono Font:** the same interface stack; use the existing browser monospace stack only for immutable IDs, code, and machine-readable values.

**Character:** A single sans-serif family gives the editor, library, and lesson player one coherent voice. Type communicates hierarchy through weight, spacing, and grouping, never through display serifs or all-caps noise.

### Hierarchy

- **Display:** reserved for login and library entry points, never inside the editor chrome.
- **Headline:** page and pane headings that orient an author or learner.
- **Title:** guide names, inspector sections, dialog titles, and meaningful node titles.
- **Body:** the baseline for instructions and Markdown prose; constrain long reading copy to 65–75 characters per line.
- **Label:** controls, metadata, steps, and table-like information. Keep labels sentence case and direct.

**The Task-Type Rule.** Text that controls work is compact and stable; text that teaches can breathe. Do not use fluid, viewport-dependent headline sizes inside a product workspace.

## Elevation

Depth comes from material opacity, subtle separators, and tonal steps first. Shadows are a last-mile spatial cue for a floating element, never a way to decorate static cards. Dark appearance communicates elevation primarily by using a slightly lighter material layer, not by increasing black shadows.

### Shadow Vocabulary

- **Rest:** no shadow on ordinary content surfaces, guide rows, or canvas nodes.
- **Floating:** a diffuse shadow for a popover, dialog, detached inspector, or context menu; it must be paired with a stronger material and a semantic elevation reason.
- **Pressed:** no shadow; use a brief tonal change and a one-pixel visual settle instead.
- **Focus:** a visible, high-contrast outer ring, never a blurred glow that could be mistaken for decoration.

**The Weight-Not-Glow Rule.** Material opacity and tonal separation carry hierarchy. Blurred shadows, glow borders, and chromatic refraction are forbidden in the productive core of the application.

## Components

### Appearance Control

- **Style:** expose System, Light, and Dark as a compact segmented control in the account menu or settings. System is the default; each selection has a visible text label, not a sun/moon icon alone.
- **Behavior:** changing appearance updates every semantic token at once. Preserve the preference locally and respect increased-contrast and reduced-motion media preferences.

### Buttons

- **Shape:** gently rounded controls using the control radius. Primary buttons are compact, calm, and unique within their immediate action group.
- **Primary:** publish, save, create, confirm, and proceed. Use one per local region when a clear next action exists.
- **Secondary / Ghost:** secondary buttons use a strong material or no fill. Ghost buttons are for toolbar and low-risk actions, never for destructive confirmation.
- **Hover / Focus / Active:** hover changes the material or action tone, focus receives a 2–3px outer ring, and active settles without scale bounce. Disabled buttons remain legible but unavailable.

### Icon Buttons

- **Style:** a 40px square or circle with a familiar icon and a programmatic accessible name. Pair an icon with a visible label when the action is unfamiliar or consequential.
- **Use:** back, close, undo, redo, and editor tools. Do not use decorative icons or mimic Apple system symbols.

### Inputs / Fields

- **Style:** use strong material with a precise separator and visible label. Inputs are 44px high for touch comfort and keep instructional text opaque.
- **Focus:** change the border and add the same focus ring used by buttons. Error text appears directly beneath the field and describes how to recover.
- **Search:** a single prominent input in the library. Filters progressively reveal only when results or task complexity need them.

### Navigation

- **App Bar and Toolbars:** use context material with a bottom separator. Keep one navigation hierarchy at a time: library path, editor tools, or lesson progress.
- **Steps and Tabs:** selected state uses action color plus shape or weight, not color alone. On narrow screens, preserve the active destination and move supplementary controls into an accessible overflow surface.

### Cards / Containers

- **Guide Rows:** use one grouped surface with row separation for search results and drafts. A guide becomes a distinct card only when it must behave as a self-contained object.
- **Panels:** the inspector, lesson detail pane, and modal sheet are material layers because they sit beside or above context. Avoid nested cards inside these panels.

### Canvas Nodes

- **Style:** node type is communicated by a compact label, clear title, and structural shape, not by a rainbow of fills. Normal nodes remain opaque; selected nodes use the focus treatment and a modest material lift.
- **Media:** image and video frames keep a stable opaque backing so text, controls, and resize handles remain legible over any uploaded asset.

### Overlays and Primitive Sources

- **Dialog, Popover, Tooltip, Tabs, Switch, Toggle Group, and Scroll Area:** use accessible behavioral primitives, preferably [Radix Primitives](https://www.radix-ui.com/primitives), and apply this token system rather than accepting a library’s default visual language.
- **Reference inventory:** [shadcn/ui’s component catalog](https://ui.shadcn.com/docs/components) is a useful pattern index for command menus, sheets, sidebars, skeletons, and tables. Treat it as a structural reference, not a Tailwind dependency or a license to import a second visual system.
- **React gallery choice:** use [React Bits](https://reactbits.dev/get-started/index) only for a single bounded `Glass Surface` treatment in a login illustration or an intentional empty state. Reject its animated glass, glow, shader, tile, and gallery treatments in the library, editor, and lesson flows.

**The One-Action Rule.** A user should be able to identify the next meaningful action in a region within a glance. If two actions feel equally primary, the flow needs a decision before more visual emphasis is added.

## Do's and Don'ts

### Do:

- **Do** use the semantic light and dark token pairs together; theme changes are complete system changes, not background swaps.
- **Do** keep material layers purposeful, localized, and stronger when they carry text or controls over media.
- **Do** provide default, hover, focus-visible, active, disabled, loading, error, and success states for each interactive component.
- **Do** use 44px touch targets for primary touch controls and preserve all existing keyboard workflows.
- **Do** use skeletons that match content shape for page-level loading and direct status messages for save or publish feedback.
- **Do** collapse structure, not information, on small screens: toolbars become overflow actions, inspectors become sheets, and the active learning step stays prominent.

### Don't:

- **Don't** recreate the generic enterprise dashboards built from repeated cards, loud status colors, and metric-first hero panels named in `PRODUCT.md`.
- **Don't** use the dark “AI tool” aesthetics named in `PRODUCT.md`: black voids, neon purple or cyan gradients, glowing borders, shader backgrounds, or ornamental motion.
- **Don't** use decorative glassmorphism: no blur on every container, no uncontrolled translucent text, and no low-contrast frosted cards.
- **Don't** imitate Apple through copied icons, device frames, traffic-light controls, faux system windows, or proprietary assets.
- **Don't** use editorial serif display type in authoring controls, data, menus, or step-by-step teaching content.
- **Don't** use gradient text, colored side-stripe borders, identical card grids, bounce effects, or a modal before inline or progressive disclosure has been considered.
