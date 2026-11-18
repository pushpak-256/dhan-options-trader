import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { DhanAuthService } from '../services/dhanAuthService';

interface DhanLoginModalProps {
  visible: boolean;
  loginUrl: string | null;
  onTokenCaptured: (tokenId: string) => void;
  onClose: () => void;
}

export const DhanLoginModal: React.FC<DhanLoginModalProps> = ({
  visible,
  loginUrl,
  onTokenCaptured,
  onClose,
}) => {
  const WebViewComponent: any = WebView;
  const capturedRef = useRef<boolean>(false);
  const [webViewLoading, setWebViewLoading] = useState<boolean>(true);
  const [manualInput, setManualInput] = useState<string>('');
  const [webError, setWebError] = useState<string | null>(null);
  const [openedWindow, setOpenedWindow] = useState<boolean>(false);

  useEffect(() => {
    if (visible) {
      capturedRef.current = false;
      setWebViewLoading(true);
      setManualInput('');
      setWebError(null);
      setOpenedWindow(false);
    }
  }, [visible, loginUrl]);

  const tryCaptureFromUrl = (url: string): boolean => {
    if (!url || capturedRef.current) return false;
    const tokenId = DhanAuthService.extractTokenIdFromUrl(url);
    if (tokenId) {
      capturedRef.current = true;
      onTokenCaptured(tokenId);
      return true;
    }
    return false;
  };

  const handleOpenBrowserWindow = (sameTab: boolean = false) => {
    if (!loginUrl || typeof window === 'undefined') return;
    setWebError(null);
    setOpenedWindow(true);
    if (sameTab) {
      window.location.assign(loginUrl);
      return;
    }
    const popup = window.open(loginUrl, '_blank', 'noopener,noreferrer');
    if (!popup) {
      // Fallback to same-tab redirect if browser blocked popup
      window.location.assign(loginUrl);
    }
  };

  const handleManualSubmit = () => {
    const raw = manualInput.trim();
    if (!raw) {
      setWebError('Please paste the redirect URL or tokenId from Dhan.');
      return;
    }

    const extracted = DhanAuthService.extractTokenIdFromUrl(raw);
    const tokenId =
      extracted || (!raw.includes('://') && !/\s/.test(raw) ? raw : null);

    if (!tokenId) {
      setWebError(
        'Could not find a tokenId in that input. Paste the full redirect URL (?tokenId=...) or raw tokenId.'
      );
      return;
    }

    if (capturedRef.current) return;
    capturedRef.current = true;
    setWebError(null);
    onTokenCaptured(tokenId);
  };

  if (!visible || !loginUrl) {
    return null;
  }

  // Web / PWA Modal Flow
  if (Platform.OS === 'web') {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.webBackdrop}>
          <View style={styles.webModalCard}>
            <View style={styles.webHeader}>
              <View>
                <Text style={styles.headerTitle}>🔐 Login with Dhan</Text>
                <Text style={styles.headerSub}>auth.dhan.co • OAuth Consent</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeBtnText}>✕ Cancel</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.webDesc}>
              Sign in securely on Dhan using your Mobile, PIN, or OTP. Once approved, Dhan will redirect straight back to this app with your session token.
            </Text>

            <TouchableOpacity
              style={styles.primaryOpenBtn}
              onPress={() => handleOpenBrowserWindow(true)}
            >
              <Text style={styles.primaryOpenBtnText}>
                Open Dhan Login Window ➔
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryOpenLink}
              onPress={() => handleOpenBrowserWindow(false)}
            >
              <Text style={styles.secondaryOpenLinkText}>
                Open in a new tab instead ↗
              </Text>
            </TouchableOpacity>

            {openedWindow ? (
              <Text style={styles.openedHint}>
                Login window opened — after approving on Dhan, return here or paste the redirect URL below.
              </Text>
            ) : null}

            <View style={styles.backupDivider} />

            <Text style={styles.backupLabel}>
              Or paste redirect URL / tokenId here
            </Text>
            <TextInput
              style={styles.backupInput}
              placeholder="https://.../?tokenId=... or paste tokenId"
              placeholderTextColor="#64748B"
              value={manualInput}
              onChangeText={(txt) => {
                setManualInput(txt);
                if (webError) setWebError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {webError ? (
              <Text style={styles.errorText}>⚠️ {webError}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.completeBtn}
              onPress={handleManualSubmit}
            >
              <Text style={styles.completeBtnText}>✓ Complete Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Native Android / iOS Full-Screen Embedded WebView Modal
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.nativeContainer}>
        <View style={styles.nativeHeader}>
          <View>
            <Text style={styles.headerTitle}>🔐 Login with Dhan</Text>
            <Text style={styles.headerSub}>Secure PIN / OTP Sign-In</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Cancel</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.webViewWrap}>
          <WebViewComponent
            source={{ uri: loginUrl }}
            style={styles.webView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
            onNavigationStateChange={(navState: { url?: string }) => {
              if (navState?.url) {
                tryCaptureFromUrl(navState.url);
              }
            }}
            onShouldStartLoadWithRequest={(request: { url?: string }) => {
              if (request?.url && tryCaptureFromUrl(request.url)) {
                return false;
              }
              return true;
            }}
          />

          {webViewLoading ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#10B981" />
              <Text style={styles.loadingText}>Loading Dhan Login...</Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  nativeContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  nativeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  closeBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
  },
  closeBtnText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  webViewWrap: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#0F172A',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  webBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.84)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  webModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  webDesc: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  primaryOpenBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOpenBtnText: {
    color: '#052E16',
    fontWeight: '900',
    fontSize: 14,
  },
  secondaryOpenLink: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  secondaryOpenLinkText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  openedHint: {
    color: '#34D399',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  backupDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 14,
  },
  backupLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  backupInput: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 12,
  },
  errorText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  completeBtn: {
    marginTop: 10,
    backgroundColor: '#0284C7',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  completeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
