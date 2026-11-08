# dsh-think-guard

English | [简体中文](README.md)

Author: **Wesley.T** · License: [MIT](LICENSE)

An independent supervision plugin for DeepSeek Harness (DSH). It uses a separately selected model to review the main agent's activity and final replies, and can suggest corrections when advice mode is enabled.

## Features

- **Observe or advise:** observe mode records findings; advice mode can queue evidence-based suggestions. Delivery does not mean a suggestion was adopted.
- **Approvals:** delegate to the system, ask the user, use automatic approval, or use autonomous review. Standard and high-frequency settings select operations for review. Only matching calls intercepted by DSH hooks are covered; this is not a sandbox or a complete safety guarantee.
- **Final-output review:** inspect a turn's final answer, including explanations, plans, and deliverables. Optional iteration has a configured limit.
- **Supervisor chat:** discuss the task separately and select or paste images. Sent images appear in chat history and are sent again when you ask follow-up questions about them, which may incur additional model cost. Ordinary chat is not automatically written into the main session. Explicit forwarding requests are handled and reported by the plugin.
- **Read-only inspection:** inspect supported text, PDF, DOCX, PPTX, XLSX, and image files within the workspace. Paths or links resolving outside it are rejected. Images require a compatible model and provider.
- **Standard and detailed inspection:** detailed mode increases budgets and analyzes longer document text in segments, resulting in additional calls and cost. This setting is separate from approval frequency.

## Installation

Install from npm (replace `desktop` with your DSH profile):

```sh
dsh plugin --profile desktop add dsh-think-guard
```

Install from GitHub source (replace `desktop` with the profile you use; this path has not yet been verified in a clean DSH environment):

```sh
dsh plugin --profile desktop add github:Stars-ETO/dsh-think-guard
```

This is a DSH plugin, not a standalone application. Install it from a plugin directory or release archive through a DSH version that supports plugins, configure a model provider, then reload the plugin or restart DSH. Open the supervisor from the conversation header. Installation UI varies by DSH version.

Keep the package structure intact, including `package.json`, `cordis.patch.yml`, `lib/`, and `vendor/`. For a local link, a DSH desktop profile can use `pnpm add "link:<absolute-plugin-directory>"` and add `dsh-think-guard` to its bundle configuration; check your DSH documentation.

For development, use Node.js 20.19 or later:

```sh
npm test
```

Tests use synthetic input and mocked model services; they do not establish compatibility with every DSH version or real model provider. The implementation was developed against DSH 0.2.2-rc.1 interfaces; verify other versions independently. The UI is primarily Chinese; this English README does not imply complete UI localization.

## Usage and limits

Enable supervision in the desired conversation and choose the model and observe/advice mode. Supervisor chat can inspect files by workspace path. A request may include up to three images; uploaded images are limited to 4 MB each. If image processing fails, the plugin reports that images were not inspected and attempts a text-only review when possible.

File size, pages, text, model context, output and time are bounded. Segmented review can omit details and should not be treated as proof of complete inspection. PDF extraction covers text and some embedded bitmaps, not complete page rendering; Office layout, native charts and some media may remain unchecked.

Autonomous review may handle a one-time sandbox elevation request only when it can associate it with the current tool call. Full access for one invocation can reach the entire host, not just one file. Model decisions can be wrong; other system and plugin denials remain in effect.

## Privacy

Selected providers may receive parts of the main conversation, requested file text, images and tool call information. DSH may store image attachment copies. Supervisor chat history stores image attachment references; clearing the chat removes those references but does not delete DSH's attachment cache. Supervisor chat and instructions are stored per session under `DSH_HOME/think-guard/memory` (default `~/.dsh/think-guard/memory`) and may contain sensitive data. Do not include that directory in a repository or release. Clearing displayed records does not undo actions already performed.

## License

Project code is licensed under [MIT](LICENSE). Bundled third-party components retain their own licenses: PDF.js, CMaps and fonts under `vendor/pdfjs/`, Schemastery under `vendor/schemastery/`, and Cosmokit under `vendor/cosmokit/`. Preserve their notices when redistributing.
