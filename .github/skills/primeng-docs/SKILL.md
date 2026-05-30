---
name: primeng-docs
version: 1.0.0
description: |
  PrimeNG component documentation lookup. Maps every PrimeNG component to its
  docs URL and provides patterns for fetching component API references,
  templates, and usage. Use when working with Angular apps that depend on
  PrimeNG or when asked about a PrimeNG component's API, inputs, outputs,
  or usage patterns.
---

## Dynamic context

No default `!` pre-execution injection is recommended. This skill is a
reference index — live shell output adds little to the shared baseline.

# PrimeNG Docs Skill

## Purpose

Provides a complete index of PrimeNG components with their documentation URLs
and patterns for retrieving component details. When an agent needs to use or
understand a PrimeNG component, this skill tells them exactly where to look.

## When to Use

Activate this skill when:

- Writing or reviewing Angular templates that use PrimeNG components
- A component's API (inputs, outputs, methods, events) is needed
- Debugging PrimeNG component behavior or styling
- Setting up PrimeNG in a project
- Looking up theming, passthrough, or Tailwind integration docs

## How to Look Up a Component

Three methods, in order of preference:

### 1. MCP Server (preferred)

If the PrimeNG MCP server is configured in the environment, use it directly.
See: https://primeng.org/mcp for setup.

```
npx @primeng/mcp-server
```

The MCP server provides structured access to all component APIs, inputs,
outputs, methods, and templates.

### 2. Fetch component page directly

Every component lives at `https://primeng.org/<component-name>/`.
The page includes API tables, live examples, and template snippets.

Agent should fetch the page and extract the relevant sections — API tables,
code examples, or configuration options. The page content includes both the
component overview and full API reference.

### 3. LLMs.txt endpoints (LLM-optimized)

PrimeNG provides component-level LLMs.txt content at:
`https://primeng.org/<component-name>/llms.txt`

Each endpoint returns structured markdown with:
- Component selector, import path, module
- Inputs, outputs, methods table
- Template examples
- Related components

Fetch this when you need a concise, structured API dump for a specific
component.

## Component Index

### Forms & Inputs

| Component | URL |
|-----------|-----|
| AutoComplete | https://primeng.org/autocomplete |
| CascadeSelect | https://primeng.org/cascadeselect |
| Checkbox | https://primeng.org/checkbox |
| ColorPicker | https://primeng.org/colorpicker |
| DatePicker | https://primeng.org/datepicker |
| FloatLabel | https://primeng.org/floatlabel |
| IftaLabel | https://primeng.org/iftalabel |
| IconField | https://primeng.org/iconfield |
| InputGroup | https://primeng.org/inputgroup |
| InputMask | https://primeng.org/inputmask |
| InputNumber | https://primeng.org/inputnumber |
| InputOtp | https://primeng.org/inputotp |
| InputText | https://primeng.org/inputtext |
| KeyFilter | https://primeng.org/keyfilter |
| Knob | https://primeng.org/knob |
| Listbox | https://primeng.org/listbox |
| MultiSelect | https://primeng.org/multiselect |
| Password | https://primeng.org/password |
| RadioButton | https://primeng.org/radiobutton |
| Rating | https://primeng.org/rating |
| Select | https://primeng.org/select |
| SelectButton | https://primeng.org/selectbutton |
| Slider | https://primeng.org/slider |
| Textarea | https://primeng.org/textarea |
| ToggleButton | https://primeng.org/togglebutton |
| ToggleSwitch | https://primeng.org/toggleswitch |
| TreeSelect | https://primeng.org/treeselect |

### Data

| Component | URL |
|-----------|-----|
| DataView | https://primeng.org/dataview |
| OrderList | https://primeng.org/orderlist |
| OrganizationChart | https://primeng.org/organizationchart |
| Paginator | https://primeng.org/paginator |
| PickList | https://primeng.org/picklist |
| Table | https://primeng.org/table |
| Timeline | https://primeng.org/timeline |
| Tree | https://primeng.org/tree |
| TreeTable | https://primeng.org/treetable |
| VirtualScroller | https://primeng.org/scroller |

### Panels & Overlays

| Component | URL |
|-----------|-----|
| Accordion | https://primeng.org/accordion |
| Card | https://primeng.org/card |
| ConfirmDialog | https://primeng.org/confirmdialog |
| ConfirmPopup | https://primeng.org/confirmpopup |
| ContextMenu | https://primeng.org/contextmenu |
| Dialog | https://primeng.org/dialog |
| Divider | https://primeng.org/divider |
| Drawer | https://primeng.org/drawer |
| DynamicDialog | https://primeng.org/dynamicdialog |
| Fieldset | https://primeng.org/fieldset |
| Panel | https://primeng.org/panel |
| Popover | https://primeng.org/popover |
| ScrollPanel | https://primeng.org/scrollpanel |
| Splitter | https://primeng.org/splitter |
| Stepper | https://primeng.org/stepper |
| Tabs | https://primeng.org/tabs |
| Toolbar | https://primeng.org/toolbar |

### Navigation

| Component | URL |
|-----------|-----|
| Breadcrumb | https://primeng.org/breadcrumb |
| Dock | https://primeng.org/dock |
| MegaMenu | https://primeng.org/megamenu |
| Menu | https://primeng.org/menu |
| Menubar | https://primeng.org/menubar |
| PanelMenu | https://primeng.org/panelmenu |
| SpeedDial | https://primeng.org/speeddial |
| SplitButton | https://primeng.org/splitbutton |
| TabMenu | https://primeng.org/tabmenu |
| TieredMenu | https://primeng.org/tieredmenu |

### Media & Content

| Component | URL |
|-----------|-----|
| Avatar | https://primeng.org/avatar |
| Badge | https://primeng.org/badge |
| BlockUI | https://primeng.org/blockui |
| Button | https://primeng.org/button |
| Carousel | https://primeng.org/carousel |
| Chart | https://primeng.org/chart |
| Chip | https://primeng.org/chip |
| Editor | https://primeng.org/editor |
| FileUpload | https://primeng.org/fileupload |
| Galleria | https://primeng.org/galleria |
| Image | https://primeng.org/image |
| ImageCompare | https://primeng.org/imagecompare |
| Inplace | https://primeng.org/inplace |
| Message | https://primeng.org/message |
| MeterGroup | https://primeng.org/metergroup |
| ProgressBar | https://primeng.org/progressbar |
| ProgressSpinner | https://primeng.org/progressspinner |
| Ripple | https://primeng.org/ripple |
| ScrollTop | https://primeng.org/scrolltop |
| Skeleton | https://primeng.org/skeleton |
| Tag | https://primeng.org/tag |
| Terminal | https://primeng.org/terminal |
| Toast | https://primeng.org/toast |
| Tooltip | https://primeng.org/tooltip |

### Utilities

| Component | URL |
|-----------|-----|
| AnimateOnScroll | https://primeng.org/animateonscroll |
| AutoFocus | https://primeng.org/autofocus |
| DragDrop | https://primeng.org/dragdrop |
| Fluid | https://primeng.org/fluid |
| FocusTrap | https://primeng.org/focustrap |
| StyleClass | https://primeng.org/styleclass |

## Guides

| Guide | URL |
|-------|-----|
| Installation | https://primeng.org/installation |
| Configuration | https://primeng.org/configuration |
| Styled Mode | https://primeng.org/theming/styled |
| Unstyled Mode | https://primeng.org/theming/unstyled |
| Icons | https://primeng.org/icons |
| Custom Icons | https://primeng.org/customicons |
| Pass Through | https://primeng.org/passthrough |
| Tailwind CSS | https://primeng.org/tailwind |
| Accessibility | https://primeng.org/guides/accessibility |
| Animations | https://primeng.org/guides/animations |
| RTL | https://primeng.org/guides/rtl |
| Migration v19 | https://primeng.org/migration/v19 |
| Migration v20 | https://primeng.org/migration/v20 |
| Migration v21 | https://primeng.org/migration/v21 |
| Overlay API | https://primeng.org/overlay |

## Component Import Patterns

All PrimeNG components are standalone in v19+. Import directly:

```ts
import { Button } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { Dialog } from 'primeng/dialog';
```

Some legacy components still use `*Module` naming. Check the specific
component's docs for the exact import.

## Quick Lookup Workflow

When asked about a PrimeNG component:

1. **Identify** the component from the index above
2. **Fetch** its LLMs.txt endpoint for structured API
3. **Fetch** the component page if live examples are needed
4. **Reference** relevant guides for cross-cutting concerns (theming,
   passthrough, accessibility)

If the exact component name is unclear, search the PrimeNG site or check
the full component list at https://primeng.org/components.
