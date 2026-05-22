(async () => {
  const VERCEL_API_URL = "https://vercel.com/astonct-gmailcoms-projects/ghostwriter-responder/3dZfM5GQoiy9jEwPYzvxoyu7H5nQ";

  // ─── Platform Detection ───────────────────────────────────────────────────

  const isGoogleBusiness = window.location.hostname === "business.google.com";
  const isYelp = window.location.hostname === "www.yelp.com";

  // ─── Retrieve Saved Email ─────────────────────────────────────────────────

  function getSavedEmail() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["ghostwriter_email"], (result) => {
        resolve(result.ghostwriter_email || null);
      });
    });
  }

  // ─── Platform-Specific Selectors ─────────────────────────────────────────

  function getPlatformConfig() {
    if (isGoogleBusiness) {
      return {
        reviewCardSelector: "[data-review-id], .WjTXhc, .jftiEf",
        reviewTextSelector: ".lqh62c, .review-full-text, [data-expandable-section]",
        replyTextareaSelector: "textarea.Al2pBd, textarea[aria-label*='reply'], textarea[aria-label*='Reply'], .DU9Pgb textarea",
        actionTraySelector: ".GgVAEe, .review-actions, .jxjCjc",
        buttonClass: "ghostwriter-btn-google",
      };
    }
    if (isYelp) {
      return {
        reviewCardSelector: "[data-review-id], .review__373c0__13kpL, .y-css-1sqfyve",
        reviewTextSelector: ".comment__373c0__3EKjH p, .raw__373c0__3rKqk, [lang] p",
        replyTextareaSelector: "textarea[name='response'], textarea.y-css-lfx5p, .biz-owner-reply textarea",
        actionTraySelector: ".review-footer, .actions__373c0__1MHXO, .review-content .y-css-hgkpq7",
        buttonClass: "ghostwriter-btn-yelp",
      };
    }
    return null;
  }

  // ─── Inject Global Styles ─────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("ghostwriter-styles")) return;
    const style = document.createElement("style");
    style.id = "ghostwriter-styles";
    style.textContent = `
      .ghostwriter-btn-google {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: 8px;
        padding: 6px 14px;
        background: #1a73e8;
        color: #fff;
        font-family: 'Google Sans', Roboto, Arial, sans-serif;
        font-size: 13px;
        font-weight: 500;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.18s ease, opacity 0.18s ease;
        white-space: nowrap;
        vertical-align: middle;
        line-height: 20px;
      }
      .ghostwriter-btn-google:hover {
        background: #1765cc;
      }
      .ghostwriter-btn-google:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
      .ghostwriter-btn-yelp {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: 8px;
        padding: 7px 16px;
        background: #d32323;
        color: #fff;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.18s ease, opacity 0.18s ease;
        white-space: nowrap;
        vertical-align: middle;
        line-height: 20px;
      }
      .ghostwriter-btn-yelp:hover {
        background: #b01d1d;
      }
      .ghostwriter-btn-yelp:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
      .ghostwriter-error-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        background: #323232;
        color: #fff;
        font-family: sans-serif;
        font-size: 13px;
        line-height: 1.5;
        padding: 12px 18px;
        border-radius: 6px;
        max-width: 340px;
        box-shadow: 0 4px 18px rgba(0,0,0,0.22);
        animation: gw-fadein 0.22s ease;
      }
      @keyframes gw-fadein {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Error Toast ──────────────────────────────────────────────────────────

  function showErrorToast(message) {
    const existing = document.querySelector(".ghostwriter-error-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "ghostwriter-error-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // ─── Extract Review Text ──────────────────────────────────────────────────

  function extractReviewText(reviewCard, config) {
    const textEl = reviewCard.querySelector(config.reviewTextSelector);
    if (textEl) {
      const fullText = textEl.innerText || textEl.textContent || "";
      return fullText.trim();
    }
    // Fallback: grab longest visible text node block in the card
    const allParagraphs = reviewCard.querySelectorAll("p, span, div");
    let longest = "";
    allParagraphs.forEach((el) => {
      const t = (el.innerText || el.textContent || "").trim();
      if (t.length > longest.length && t.length < 3000) longest = t;
    });
    return longest;
  }

  // ─── Fill Native Textarea ─────────────────────────────────────────────────

  function fillNativeTextarea(reviewCard, replyText, config) {
    // Search within the card first, then broaden to nearest form/section
    let textarea = reviewCard.querySelector(config.replyTextareaSelector);
    if (!textarea) {
      const parent = reviewCard.closest("section, article, [role='main']") || document.body;
      textarea = parent.querySelector(config.replyTextareaSelector);
    }
    if (!textarea) {
      // Last resort: find any visible textarea on the page
      const allTextareas = Array.from(document.querySelectorAll("textarea"));
      textarea = allTextareas.find((t) => {
        const style = window.getComputedStyle(t);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    }
    if (!textarea) {
      showErrorToast("GhostWriter: Couldn't find the reply box. Please click 'Reply' on the review first, then try again.");
      return false;
    }

    // React / Angular friendly native setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (nativeInputValueSetter && nativeInputValueSetter.set) {
      nativeInputValueSetter.set.call(textarea, replyText);
    } else {
      textarea.value = replyText;
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.focus();
    return true;
  }

  // ─── Core: Handle Button Click ────────────────────────────────────────────

  async function handleDraftClick(button, reviewCard, config) {
    const email = await getSavedEmail();
    if (!email) {
      showErrorToast("GhostWriter: No account email saved. Please open the GhostWriter extension popup and enter your email first.");
      return;
    }

    const reviewText = extractReviewText(reviewCard, config);
    if (!reviewText || reviewText.length < 5) {
      showErrorToast("GhostWriter: Couldn't read this review's text. The page layout may have changed.");
      return;
    }

    const originalLabel = button.textContent;
    button.textContent = "⏳ Thinking...";
    button.disabled = true;

    try {
      const response = await fetch(VERCEL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reviewText }),
      });

      const data = await response.json();

      if (!response.ok) {
        const serverMessage = data?.error || "An unexpected error occurred.";
        showErrorToast(`GhostWriter: ${serverMessage}`);
        return;
      }

      const replyText = data?.replyText;
      if (!replyText) {
        showErrorToast("GhostWriter: The AI returned an empty reply. Please try again.");
        return;
      }

      const filled = fillNativeTextarea(reviewCard, replyText, config);
      if (filled) {
        button.textContent = "✅ Reply Drafted!";
        setTimeout(() => {
          button.textContent = originalLabel;
        }, 3000);
        return;
      }
    } catch (err) {
      console.error("[GhostWriter] Fetch error:", err);
      showErrorToast("GhostWriter: Network error. Please check your connection and try again.");
    } finally {
      button.disabled = false;
      if (button.textContent === "⏳ Thinking...") {
        button.textContent = originalLabel;
      }
    }
  }

  // ─── Inject Button Into a Review Card ────────────────────────────────────

  function injectButtonIntoCard(reviewCard, config) {
    if (reviewCard.dataset.ghostwriterActive === "true") return;
    reviewCard.dataset.ghostwriterActive = "true";

    const button = document.createElement("button");
    button.textContent = "✨ Draft Smart Reply";
    button.className = config.buttonClass;
    button.setAttribute("aria-label", "Draft a smart AI reply to this review");
    button.setAttribute("type", "button");

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDraftClick(button, reviewCard, config);
    });

    // Try to place inside the action tray, else append to card bottom
    const actionTray = reviewCard.querySelector(config.actionTraySelector);
    if (actionTray) {
      actionTray.appendChild(button);
    } else {
      button.style.margin = "10px 0 4px 0";
      reviewCard.appendChild(button);
    }
  }

  // ─── Scan DOM for New Review Cards ───────────────────────────────────────

  function scanAndInject(config) {
    const cards = document.querySelectorAll(config.reviewCardSelector);
    cards.forEach((card) => injectButtonIntoCard(card, config));
  }

  // ─── MutationObserver: Watch for Dynamically Loaded Reviews ──────────────

  function startObserver(config) {
    scanAndInject(config);

    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) scanAndInject(config);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  const config = getPlatformConfig();
  if (!config) return; // Not a supported platform

  injectStyles();
  startObserver(config);
})();
