import type { Language } from './i18n';

/** Static shell copy only; unknown messages and customer content remain unchanged. */
export const adminShellTranslations = {
  'Staff workspace': 'दुकान प्रबंधन',
  'The shop, in order.': 'दुकान का व्यवस्थित प्रबंधन।',
  'Quotes, packages and every rupee accounted for.': 'कोटेशन, पैकेज और हर रुपये का हिसाब।',
  'Customer view': 'ग्राहक दृश्य',
  'Public catalog': 'सार्वजनिक उत्पाद सूची',
  'Sign out': 'साइन आउट करें',
  'Setup preview. The shop is not connected; no orders, stock or payments are simulated.': 'सेटअप पूर्वावलोकन। दुकान जुड़ी नहीं है; कोई ऑर्डर, स्टॉक या भुगतान नकली रूप से दर्ज नहीं होता।',
  'Offline. All administrative changes require a confirmed server response.': 'ऑफ़लाइन। सभी प्रशासनिक बदलावों के लिए सर्वर की पुष्टि आवश्यक है।',
  'Verifying staff access and refreshing records…': 'प्रशासनिक अनुमति जाँची जा रही है और रिकॉर्ड ताज़ा किए जा रहे हैं…',
  'Authorized staff only': 'केवल अधिकृत कर्मचारियों के लिए',
  'Sign in with Google. The server, not this page, decides who can administer the shop.': 'Google से साइन इन करें। दुकान का प्रबंधन कौन कर सकता है, यह सर्वर तय करता है, यह पृष्ठ नहीं।',
  'Continue with Google': 'Google से जारी रखें',
  'Retry access check': 'अनुमति फिर जाँचें',
  'Staff sections': 'प्रबंधन अनुभाग',
  'Orders & enquiries': 'ऑर्डर और पूछताछ',
  'Customers': 'ग्राहक',
  'Counter sale': 'काउंटर बिक्री',
  'Products & stock': 'उत्पाद और स्टॉक',
  'Ledger': 'बहीखाता',
  'Reports': 'रिपोर्ट',
  'Staff & requests': 'कर्मचारी और अनुरोध',
  'This Google account does not have staff access. Use the customer view.': 'इस Google खाते को प्रशासनिक अनुमति नहीं है। ग्राहक दृश्य का उपयोग करें।',
  'Wait for a connected, verified staff session.': 'जुड़े हुए और सत्यापित प्रशासनिक सत्र की प्रतीक्षा करें।',
  'Account changed. Reload the current account before continuing.': 'खाता बदल गया है। आगे बढ़ने से पहले वर्तमान खाता फिर लोड करें।',
  'Verified online staff session required.': 'सत्यापित ऑनलाइन प्रशासनिक सत्र आवश्यक है।',
  'Account changed.': 'खाता बदल गया है।',
  'Incomplete confirmation.': 'पुष्टि अधूरी है।',
  'Estimate settings saved by the server.': 'अनुमान सेटिंग सर्वर पर सहेजी गई हैं।',
} as const;
export function adminShellText(text: string, locale: Language): string {
  return locale === 'hi' && Object.hasOwn(adminShellTranslations, text)
    ? adminShellTranslations[text as keyof typeof adminShellTranslations] : text;
}
