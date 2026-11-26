import type { Language } from './i18n';

/** Static account UI only; never translate customer records or server-provided notes. */
export const accountTranslations = {
  'Google account:': 'Google खाता:',
  'Connected': 'जुड़ा हुआ',
  'Your mobile number is recorded separately.': 'आपका मोबाइल नंबर अलग से दर्ज किया जाता है।',
  'Required for order contact. Google sign-in does not verify this number.': 'ऑर्डर के संबंध में संपर्क के लिए आवश्यक। Google साइन-इन इस नंबर का सत्यापन नहीं करता।',
  'Phone status:': 'फ़ोन की स्थिति:',
  'Staff confirmation and SMS verification are distinct. Neither lets someone claim another customer\'s order history.': 'दुकान द्वारा पुष्टि और SMS सत्यापन अलग हैं। इनमें से कोई भी किसी दूसरे ग्राहक के ऑर्डर इतिहास का अधिकार नहीं देता।',
  'Phone verification security check': 'फ़ोन सत्यापन की सुरक्षा जाँच',
  'Save your number first. SMS verification is subject to the shop\'s daily allowance and provider availability; staff can confirm your contact if it is unavailable.': 'पहले अपना नंबर सहेजें। SMS सत्यापन दुकान की दैनिक सीमा और सेवा की उपलब्धता पर निर्भर है; उपलब्ध न होने पर दुकान आपके संपर्क की पुष्टि कर सकती है।',
  'SMS is not enabled. The shop can confirm your number by a manual call or in person.': 'SMS चालू नहीं है। दुकान फ़ोन करके या व्यक्तिगत रूप से आपके नंबर की पुष्टि कर सकती है।',
  'Order history is always the record of your order. Optional push notifications are best-effort and may be delayed or blocked by your device.': 'ऑर्डर इतिहास आपके ऑर्डर का रिकॉर्ड है। वैकल्पिक पुश सूचनाएँ देर से आ सकती हैं या आपका उपकरण उन्हें रोक सकता है।',
  'Push notifications will become available after the shop completes setup.': 'दुकान का सेटअप पूरा होने के बाद पुश सूचनाएँ उपलब्ध होंगी।',
  'Net amount due to the shop': 'दुकान को देय कुल बकाया',
  'Net advance / credit recorded with the shop': 'दुकान में दर्ज शुद्ध अग्रिम / जमा राशि',
  'Your recorded account is balanced': 'आपके दर्ज खाते में कोई शेष बकाया नहीं है',
  'This is a shop ledger, not a transferable payment wallet. Deposits can be allocated to orders. Pending UPI references do not count as confirmed receipts. An account credit is not automatically a refundable cash balance.': 'यह दुकान का बहीखाता है, हस्तांतरण योग्य भुगतान वॉलेट नहीं। जमा राशि ऑर्डर में समायोजित की जा सकती है। लंबित UPI संदर्भ पुष्ट भुगतान नहीं हैं। खाते की जमा राशि अपने आप नकद वापसी योग्य नहीं होती।',
  'No financial entries have been posted.': 'अभी कोई वित्तीय प्रविष्टि दर्ज नहीं हुई है।',
  'Debit / dues increase': 'डेबिट / बकाया वृद्धि',
  'Receipt / credit': 'प्राप्ति / जमा',
  'Your balance is calculated by the server using the full ledger, not the visible page.': 'आपकी शेष राशि सर्वर पूरे बहीखाते से निकालता है, केवल दिखाई दे रहे पृष्ठ से नहीं।',
  'Loading entries…': 'प्रविष्टियाँ लोड हो रही हैं…',
  'You can request deletion here or use the contact route on our': 'आप यहाँ खाता हटाने का अनुरोध कर सकते हैं या हमारे',
  'account deletion page': 'खाता हटाने के पृष्ठ',
  'The shop will explain any records it must retain for legitimate accounting or legal obligations.': 'दुकान बताएगी कि लेखांकन या कानूनी दायित्वों के लिए कौन से रिकॉर्ड रखना आवश्यक है।',
  'for assistance.': 'पर दिए संपर्क से सहायता ले सकते हैं।',
  'I want the shop to process an account deletion request.': 'मैं चाहता/चाहती हूँ कि दुकान मेरा खाता हटाने का अनुरोध संसाधित करे।',
  'Saving contact details': 'संपर्क विवरण सहेजे जा रहे हैं',
  'Contact details saved. Changing your number resets its verification status.': 'संपर्क विवरण सहेजे गए। नंबर बदलने पर उसका सत्यापन फिर से करना होगा।',
  'Enter a valid 10-digit Indian mobile number, optionally beginning with +91.': 'मान्य 10 अंकों का भारतीय मोबाइल नंबर दर्ज करें। शुरुआत में +91 लगा सकते हैं।',
  'Requesting phone verification': 'फ़ोन सत्यापन का अनुरोध किया जा रहा है',
  'Verification request processed. If a code was sent, enter it below. No code is required at every Google sign-in.': 'सत्यापन अनुरोध संसाधित हुआ। कोड भेजा गया हो तो नीचे दर्ज करें। हर Google साइन-इन पर कोड आवश्यक नहीं है।',
  'Checking verification code': 'सत्यापन कोड जाँचा जा रहा है',
  'Phone verification completed.': 'फ़ोन सत्यापन पूरा हुआ।',
  'Enabling notifications': 'सूचनाएँ चालू की जा रही हैं',
  'Notification preference processed. Check your browser or Android permission setting.': 'सूचना की पसंद संसाधित हुई। अपने ब्राउज़र या Android की अनुमति सेटिंग जाँचें।',
  'Requesting account deletion': 'खाता हटाने का अनुरोध किया जा रहा है',
  'Your deletion request is saved for processing. It is not a confirmation that deletion is complete.': 'आपका खाता हटाने का अनुरोध प्रक्रिया के लिए सहेजा गया है। इसका अर्थ यह नहीं है कि खाता हट चुका है।',
  'SMS verification is unavailable during the Neon migration. Ask the shop for staff confirmation.': 'अभी SMS सत्यापन उपलब्ध नहीं है। पुष्टि के लिए दुकान से संपर्क करें।',
  'Push notifications are unavailable during the Neon migration. Check your order history for updates.': 'अभी पुश सूचनाएँ उपलब्ध नहीं हैं। अपडेट के लिए अपना ऑर्डर इतिहास देखें।',
} as const;
export type AccountTranslationKey = keyof typeof accountTranslations;
export function accountText(key: AccountTranslationKey, locale: Language): string {
  return locale === 'hi' ? accountTranslations[key] : key;
}
export function accountFeedback(message: string, locale: Language): string {
  return Object.hasOwn(accountTranslations, message) ? accountText(message as AccountTranslationKey, locale) : message;
}
const statuses: Record<string, string> = {
  unverified: 'असत्यापित', sms_verified: 'SMS से सत्यापित', staff_confirmed: 'दुकान द्वारा पुष्ट',
  requested: 'अनुरोध किया गया', processing: 'प्रक्रिया में', completed: 'पूर्ण', rejected: 'अस्वीकृत',
  sale: 'बिक्री', payment: 'भुगतान', refund: 'धन वापसी', return: 'वापसी', opening: 'प्रारंभिक शेष',
  opening_balance: 'प्रारंभिक शेष', adjustment: 'समायोजन', advance: 'अग्रिम',
};
export function accountStatus(value: string, locale: Language, fallback: (value: string) => string): string {
  return locale === 'hi' && Object.hasOwn(statuses, value) ? statuses[value] : fallback(value);
}
