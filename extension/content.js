/**
 * Sales Lead Generator — LinkedIn In-Page Content Reader
 * Injected on explicit user click only. Conforms strictly to LinkedIn safety rules.
 * Does NOT automate, crawl, paginate, or message.
 */
(() => {
  const clean = (text) => {
    if (!text || typeof text !== 'string') return null;
    const cleaned = text
      .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  const getElementText = (selector, root = document) => {
    try {
      const el = root.querySelector(selector);
      return el ? clean(el.textContent) : null;
    } catch {
      return null;
    }
  };

  const url = window.location.href.split('?')[0].replace(/\/+$/, '');

  // Name resolution
  let name = getElementText('h1');
  if (!name) {
    name = getElementText('.text-heading-xlarge') ||
           getElementText('.pv-top-card--list li') ||
           getElementText('.inline.t-24.t-black.t-normal');
  }

  // Headline / current role
  let headline = getElementText('.text-body-medium') ||
                 getElementText('.pv-top-card--list + div') ||
                 getElementText('.pv-top-card__headline');

  // Company name inference
  let companyName = null;
  const expSection = document.querySelector('#experience')?.closest('section');
  if (expSection) {
    const firstRole = expSection.querySelector('li .display-flex');
    if (firstRole) {
      companyName = getElementText('span.t-14.t-normal', firstRole);
    }
  }

  // Fallback company name from headline (e.g. "Head of Sales at FC Barcelona")
  if (!companyName && headline) {
    const atMatch = headline.match(/\bat\s+([^,·|]+)/i) ||
                    headline.match(/@\s*([^,·|]+)/i) ||
                    headline.match(/[-–—|]\s*([^,·|]+)$/i);
    if (atMatch && atMatch[1]) {
      companyName = clean(atMatch[1]);
    }
  }

  // Location
  let location = getElementText('.text-body-small.inline.t-black--light.break-words') ||
                 getElementText('.pv-top-card--list-bullet li') ||
                 getElementText('.pv-top-card__location');

  // About text
  let bio = null;
  const aboutSection = document.querySelector('#about')?.closest('section');
  if (aboutSection) {
    bio = getElementText('.inline-show-more-text', aboutSection) ||
          getElementText('.pv-about__summary-text', aboutSection);
  }

  // Profile photo
  let photoUrl = null;
  const photoEl = document.querySelector('img.pv-top-card-profile-picture__image') ||
                  document.querySelector('.pv-top-card__photo') ||
                  document.querySelector('img.presence-entity__image');
  if (photoEl) {
    photoUrl = photoEl.getAttribute('data-delayed-url') || photoEl.src;
    if (photoUrl && (photoUrl.startsWith('data:') || photoUrl.includes('ghost_person'))) {
      photoUrl = null;
    }
  }

  // On-page contact links if exposed
  let email = null;
  let phone = null;
  const mailtoLink = document.querySelector('a[href^="mailto:"]');
  if (mailtoLink) {
    email = mailtoLink.href.replace(/^mailto:/i, '').split('?')[0].trim();
  }

  const telLink = document.querySelector('a[href^="tel:"]');
  if (telLink) {
    phone = telLink.href.replace(/^tel:/i, '').trim();
  }

  return {
    url,
    name,
    headline,
    jobTitle: headline,
    companyName,
    location,
    bio,
    photoUrl,
    email,
    phone,
  };
})();
