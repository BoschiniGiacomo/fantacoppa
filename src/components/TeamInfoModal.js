import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { leagueService } from '../services/api';
import { defaultLogos } from '../constants/defaultLogos';

const DEFAULT_TEAM_RE = /^Squadra\s*\d+$/i;
const DEFAULT_COACH_RE = /^Allenatore\s*\d+$/i;

function isDefaultTeamName(name) {
  return DEFAULT_TEAM_RE.test(String(name || '').trim());
}

function isDefaultCoachName(name) {
  return DEFAULT_COACH_RE.test(String(name || '').trim());
}

export default function TeamInfoModal({
  visible,
  leagueId,
  leagueName,
  defaultTeamName,
  defaultCoachName,
  defaultTeamLogo,
  onSave,
}) {
  const [teamName, setTeamName] = useState('');
  const [coachName, setCoachName] = useState('');
  const [selectedLogo, setSelectedLogo] = useState('default_1');
  const [customPreviewUri, setCustomPreviewUri] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [teamError, setTeamError] = useState('');
  const [coachError, setCoachError] = useState('');

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    if (!visible) return;
    setTeamName(defaultTeamName || '');
    setCoachName(defaultCoachName || '');
    const logo = String(defaultTeamLogo || 'default_1').trim() || 'default_1';
    if (logo.startsWith('default_')) {
      setSelectedLogo(logo);
      setCustomPreviewUri(null);
    } else {
      setSelectedLogo(logo);
      setCustomPreviewUri(null);
    }
    setTeamError('');
    setCoachError('');
    setSaving(false);
  }, [visible, defaultTeamName, defaultCoachName, defaultTeamLogo]);

  const resolvedPreview = customPreviewUri
    || (selectedLogo && !String(selectedLogo).startsWith('default_') ? selectedLogo : null);

  const pickCustomLogo = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Serve l\'accesso alla galleria per caricare un\'immagine');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType?.Images || 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const picked = result.assets[0];
      const fileSizeMB = Number(picked?.fileSize || 0) / (1024 * 1024);
      if (fileSizeMB > 2) {
        showToast('Il file è troppo grande. Massimo 2MB');
        return;
      }
      setCustomPreviewUri(picked.uri);
      setSelectedLogo(picked.uri);
    } catch (error) {
      console.error('Error picking team logo:', error);
      showToast('Errore nella selezione dell\'immagine');
    }
  };

  const handleSave = async () => {
    const trimmedTeamName = teamName.trim();
    const trimmedCoachName = coachName.trim();

    let nextTeamError = '';
    let nextCoachError = '';

    if (!trimmedTeamName) {
      nextTeamError = 'Inserisci un nome squadra';
    } else if (isDefaultTeamName(trimmedTeamName)) {
      nextTeamError = 'Scegli un nome diverso da "Squadra N"';
    }

    if (!trimmedCoachName) {
      nextCoachError = 'Inserisci un nome allenatore';
    } else if (isDefaultCoachName(trimmedCoachName)) {
      nextCoachError = 'Scegli un nome diverso da "Allenatore N"';
    }

    setTeamError(nextTeamError);
    setCoachError(nextCoachError);

    if (nextTeamError || nextCoachError) {
      showToast('Correggi i campi evidenziati');
      return;
    }

    try {
      setSaving(true);
      await leagueService.updateTeamInfo(leagueId, trimmedTeamName, trimmedCoachName);

      let finalLogo = String(selectedLogo || 'default_1').startsWith('default_')
        ? (selectedLogo || 'default_1')
        : 'default_1';
      try {
        if (customPreviewUri) {
          const res = await leagueService.uploadTeamLogo(leagueId, customPreviewUri);
          finalLogo = String(res?.data?.team_logo || customPreviewUri).trim() || customPreviewUri;
        } else if (String(selectedLogo || '').startsWith('default_')) {
          await leagueService.selectDefaultLogo(leagueId, selectedLogo);
          finalLogo = selectedLogo;
        } else if (selectedLogo) {
          finalLogo = selectedLogo;
        }
      } catch (logoError) {
        console.error('Team logo save error:', logoError);
        showToast(logoError.response?.data?.message || 'Nomi salvati, logo non aggiornato');
      }

      onSave?.(trimmedTeamName, trimmedCoachName, finalLogo);
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile salvare le informazioni';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalContainer}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.hero}>
              <Text style={styles.title}>
                Benvenuto in {String(leagueName || '').trim() || 'lega'}
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Scegli Stemma</Text>
            <View style={styles.logosGrid}>
              {defaultLogos.map((logo) => {
                const isSelected = !customPreviewUri && selectedLogo === logo.id;
                return (
                  <TouchableOpacity
                    key={logo.id}
                    style={[
                      styles.logoItem,
                      { backgroundColor: `${logo.color}18` },
                      isSelected && styles.logoItemSelected,
                    ]}
                    onPress={() => {
                      setCustomPreviewUri(null);
                      setSelectedLogo(logo.id);
                    }}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.logoEmoji}>{logo.emoji}</Text>
                    {isSelected ? (
                      <View style={styles.logoCheck}>
                        <Ionicons name="checkmark-circle" size={16} color="#2e7d32" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={[
                  styles.logoItem,
                  styles.logoItemCustom,
                  customPreviewUri ? [styles.logoItemSelected, styles.logoItemCustomSelected] : null,
                ]}
                onPress={pickCustomLogo}
                disabled={saving}
                activeOpacity={0.85}
              >
                {resolvedPreview ? (
                  <Image source={{ uri: resolvedPreview }} style={styles.logoCustomImage} />
                ) : (
                  <Ionicons name="image-outline" size={22} color="#667eea" />
                )}
                {customPreviewUri ? (
                  <View style={styles.logoCheck}>
                    <Ionicons name="checkmark-circle" size={16} color="#2e7d32" />
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Nome squadra</Text>
              <TextInput
                style={[styles.input, teamError ? styles.inputError : null]}
                value={teamName}
                onChangeText={(value) => {
                  setTeamName(value);
                  if (teamError) setTeamError('');
                }}
                placeholder="Es. FC Pantere"
                placeholderTextColor="#999"
                autoCapitalize="words"
                editable={!saving}
              />
              {teamError ? <Text style={styles.fieldError}>{teamError}</Text> : null}
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Nome allenatore</Text>
              <TextInput
                style={[styles.input, coachError ? styles.inputError : null]}
                value={coachName}
                onChangeText={(value) => {
                  setCoachName(value);
                  if (coachError) setCoachError('');
                }}
                placeholder="Es. Mister Rossi"
                placeholderTextColor="#999"
                autoCapitalize="words"
                editable={!saving}
              />
              {coachError ? <Text style={styles.fieldError}>{coachError}</Text> : null}
            </View>

            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.saveButtonText}>Salva e continua</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {toastMsg ? (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 18, 28, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 18,
    width: '100%',
    maxWidth: 420,
    maxHeight: '92%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 24,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#222',
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  logosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 10,
    rowGap: 10,
    marginBottom: 18,
  },
  logoItem: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  logoItemSelected: {
    borderColor: '#667eea',
  },
  logoItemCustom: {
    backgroundColor: '#f5f7ff',
    borderStyle: 'dashed',
    borderColor: '#c5cbe8',
  },
  logoItemCustomSelected: {
    borderStyle: 'solid',
    backgroundColor: '#eef1ff',
  },
  logoEmoji: {
    fontSize: 24,
  },
  logoCustomImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  logoCheck: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  formGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 7,
  },
  input: {
    backgroundColor: '#f7f8fb',
    borderWidth: 1,
    borderColor: '#e6e8ef',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
  },
  inputError: {
    borderColor: '#e53935',
    backgroundColor: '#fff5f5',
  },
  fieldError: {
    marginTop: 6,
    fontSize: 12,
    color: '#e53935',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#667eea',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  saveButtonDisabled: {
    opacity: 0.65,
  },
  toast: {
    position: 'absolute',
    top: 72,
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
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastError: { backgroundColor: '#e53935' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});
