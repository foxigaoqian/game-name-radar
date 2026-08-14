# Case Study: Goblincremental

This case is included because it exposed the most important failure mode in the workflow.

## Initial mistake

The first prototype used the itch.io project page as the iframe source.

That produced a visually complete site whose game area was not actually playable.

The project page was browser-playable and marked HTML5, but ordinary parsed page text did not expose the underlying runtime iframe URL.

The incorrect conclusion would have been:

```text
No iframe URL visible → third-party embed cannot be confirmed
```

## Correct lesson

When an official itch.io page clearly shows `Run game` and `HTML5`, continue investigating the rendered player rather than stopping at text extraction.

The actual game runtime used an itch-hosted URL with the general form:

```text
https://html-classic.itch.zone/html/<build-id>/index.html?v=<version>
```

Once the real runtime URL was identified, the game could be evaluated as a true play-first candidate.

## Workflow improvement produced by this case

The skill now requires:

```text
resolve game
  → confirm HTML5
  → extract real runtime
  → test minimal third-party iframe
  → only then design full site
```

The site design stage must not begin with an unverified player.

## Visual lesson

Goblincremental should not receive a generic gaming landing page. Its design direction should come from its goblin/incremental/resource-management identity: progression, resources, village/economy systems, and the visual treatment shown in official assets.

The exact styling remains project-specific; the structural workflow is reusable.
