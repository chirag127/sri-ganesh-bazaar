import type { Language } from './i18n';

/** Static interface copy only; never translate record data or RPC values. */
export const adminSettingsTranslations = {
  'Private shop counts': 'दुकान के निजी आँकड़े',
  'Dates are inclusive in India time. These counts describe different stages and must not be added together. No customer details are sent to an AI service.': 'तारीखों में दोनों दिन शामिल हैं और समय भारतीय है। ये आँकड़े अलग-अलग चरणों के हैं; इन्हें जोड़ें नहीं। ग्राहक विवरण किसी AI सेवा को नहीं भेजे जाते।',
  'Enquiries submitted in period': 'अवधि में भेजी गई पूछताछ',
  'Orders created in period currently accepted, ready, dispatched or completed': 'अवधि में बने ऑर्डर जो अभी स्वीकृत, तैयार, भेजे गए या पूरे हैं',
  'Sales bills issued in period (not net of returns)': 'अवधि में जारी बिक्री बिल (वापसी घटाए बिना)',
  'Requests created in period still pending': 'अवधि में बने अनुरोध जो अभी लंबित हैं',
  'Active variants at or below threshold now (not date-filtered)': 'अभी सीमा पर या उससे कम स्टॉक वाली सक्रिय इकाइयाँ (तारीख से फ़िल्टर नहीं)',
  'Report unavailable. Check the dates and your owner access, then retry.': 'रिपोर्ट उपलब्ध नहीं है। तारीखें और अपना मालिक-अधिकार जाँचकर फिर कोशिश करें।',
  'From date': 'आरंभ तारीख', 'Through date': 'अंतिम तारीख',
  'Maximum 366 days.': 'अधिकतम 366 दिन।', 'Load report': 'रिपोर्ट देखें',
  'Loading counts…': 'आँकड़े लोड हो रहे हैं…',
  'Reconnect to load a report. Reports are not stored offline.': 'रिपोर्ट के लिए इंटरनेट से जुड़ें। रिपोर्ट ऑफ़लाइन सहेजी नहीं जाती।',
  'through': 'से', 'Measure': 'माप', 'Count': 'संख्या',
  'Customer estimate permission': 'ग्राहक की अनुमान अनुमति', 'Private cart estimates': 'निजी खरीद सूची के अनुमान',
  'Current access:': 'वर्तमान अनुमति:', 'Approved': 'स्वीकृत', 'Not approved': 'स्वीकृत नहीं',
  'This permission does not grant staff access or approve credit.': 'यह अनुमति कर्मचारी अधिकार या उधार की स्वीकृति नहीं देती।',
  'Saving permission…': 'अनुमति सहेजी जा रही है…', 'Revoke estimate access': 'अनुमान की अनुमति हटाएँ', 'Approve estimate access': 'अनुमान की अनुमति दें',
  'Change was not confirmed. Refresh records before retrying. Retrying this change uses the same request ID.': 'बदलाव की पुष्टि नहीं हुई। फिर कोशिश करने से पहले रिकॉर्ड ताज़ा करें। उसी बदलाव की दोबारा कोशिश में वही अनुरोध ID इस्तेमाल होगी।',
  'Delivery estimate range': 'वितरण शुल्क की अनुमानित सीमा',
  'Set the approximate transport range shown to approved customers. Final transport charges are confirmed in each quote. Blank fields do not represent the saved range.': 'स्वीकृत ग्राहकों को दिखाई जाने वाली परिवहन शुल्क सीमा तय करें। अंतिम शुल्क हर कोटेशन में तय होता है। खाली फ़ील्ड सहेजी गई सीमा नहीं दर्शाते।',
  'Minimum delivery charge (₹)': 'न्यूनतम वितरण शुल्क (₹)', 'Maximum delivery charge (₹)': 'अधिकतम वितरण शुल्क (₹)',
  'Saving range…': 'सीमा सहेजी जा रही है…', 'Save delivery range': 'वितरण सीमा सहेजें',
  'Check the amounts.': 'राशियाँ जाँचें।',
  'Maximum delivery charge must not be below the minimum.': 'अधिकतम वितरण शुल्क न्यूनतम से कम नहीं हो सकता।',
  'Enter a non-negative rupee amount with at most two decimal places.': 'शून्य या उससे अधिक रुपये की राशि भरें, अधिकतम दो दशमलव अंकों के साथ।',
  'That amount is too large.': 'यह राशि बहुत बड़ी है।',
} as const;
export function adminSettingsText(text: string, locale: Language): string {
  return locale === 'hi' && Object.hasOwn(adminSettingsTranslations, text)
    ? adminSettingsTranslations[text as keyof typeof adminSettingsTranslations] : text;
}
