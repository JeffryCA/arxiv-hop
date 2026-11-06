# arXiv Hop

Click citations in arXiv HTML papers to open the cited paper in a new tab. Hover over missing links to look up matching titles on arXiv; otherwise search Google.

**Install:** In Comet/Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder. Reload your paper.

**Options:** Click the toolbar icon to toggle citation links or choose HTML (default), PDF, or abstract. Choices persist and update open papers immediately. Alt-click for the bibliography. HTML availability varies by paper.

Dependency-free; no backend or tracking. Hover lookups contact arXiv's public API; results are cached locally for a day. Matches tolerate typography differences, never partial titles. Stores your preferences and a small cache.

Thank you to arXiv for use of its open access interoperability.

**Test:** `node --test tests/*.test.cjs`
