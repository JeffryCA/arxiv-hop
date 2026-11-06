# arXiv Hop

Click citations in arXiv HTML papers to open the cited paper in a new tab. Hover for a preview; missing links become clearly labeled Google searches.

**Install:** In Comet/Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder. Reload your paper.

**Options:** Click the toolbar icon to toggle citation links or choose HTML (default), PDF, or abstract. Choices persist and update open papers immediately. Alt-click for the bibliography. HTML availability varies by paper.

Local, dependency-free, no background service or tracking. Only works on arXiv HTML; stores your two preferences.

**Test:** `node --test tests/*.test.cjs`
