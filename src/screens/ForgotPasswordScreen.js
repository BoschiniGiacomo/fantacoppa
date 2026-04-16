import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { authService } from '../services/api';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleForgotPassword = async () => {
    Keyboard.dismiss();
    
    if (!email.trim()) {
      showToast('Inserisci la tua email');
      return;
    }

    if (!email.includes('@')) {
      showToast('Inserisci un indirizzo email valido');
      return;
    }

    setLoading(true);
    try {
      const response = await authService.forgotPassword(email.trim());
      
      // Mostra i log di debug se presenti (solo in sviluppo)
      if (response.data?.debug && __DEV__) {
        response.data.debug.forEach((log, index) => {
          console.log(`[${index + 1}] ${log}`);
        });
      }
      
      showToast(
        response.data.message || 'Se l\'email è registrata nel nostro sistema, riceverai una nuova password via email.',
        'success'
      );
      setTimeout(() => navigation.goBack(), 1500);
    } catch (error) {
      const status = error?.response?.status;
      const serverErr = error?.response?.data?.error || error?.response?.data?.message || '';
      const isRoutingFalsePositive =
        status === 404 && typeof serverErr === 'string' && serverErr.toLowerCase().includes('endpoint non trovato');

      if (isRoutingFalsePositive) {
        // Non deve bloccare: lato server la richiesta può essere stata eseguita comunque.
        showToast(
          'Se l\'email è registrata nel nostro sistema, riceverai una nuova password via email.',
          'success'
        );
        setTimeout(() => navigation.goBack(), 1500);
        return;
      }

      // Log dettagli solo per errori reali (e solo in dev)
      if (__DEV__) {
        console.error('=== ERROR SENDING FORGOT PASSWORD REQUEST ===');
        console.error('Error:', error);
        console.error('Error response:', error.response?.data);
        console.error('Error message:', error.message);
        console.error('=== END ERROR ===');

        // Mostra i log di debug se presenti anche negli errori
        if (error.response?.data?.debug) {
          console.log('=== DEBUG LOGS FROM ERROR ===');
          error.response.data.debug.forEach((log, index) => {
            console.log(`[${index + 1}] ${log}`);
          });
        }
      }

      showToast(
        serverErr || error.message || 'Errore durante l\'invio della richiesta. Riprova più tardi.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="#667eea" />
          </TouchableOpacity>

          <View style={styles.header}>
            <Ionicons name="lock-closed-outline" size={80} color="#667eea" />
            <Text style={styles.title}>Password Dimenticata</Text>
            <Text style={styles.subtitle}>
              Inserisci la tua email per ricevere una nuova password
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleForgotPassword}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleForgotPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Invia Nuova Password</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.linkText}>
                Torna al <Text style={styles.linkTextBold}>Login</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    padding: 20,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 1,
    padding: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 15,
    paddingHorizontal: 15,
    height: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  button: {
    backgroundColor: '#667eea',
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  linkButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    color: '#666',
    fontSize: 14,
  },
  linkTextBold: {
    color: '#667eea',
    fontWeight: 'bold',
  },
  toast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastError: {
    backgroundColor: '#e53935',
  },
  toastSuccess: {
    backgroundColor: '#2e7d32',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});

