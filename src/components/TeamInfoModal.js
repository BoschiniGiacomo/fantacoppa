import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  const coachInputRef = useRef(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    if (!visible) return;
    setTeamName('');
    setCoachName('');
    const logo = String(defaultTeamLogo || 'default_1').trim() || 'default_1';
    setSelectedLogo(logo);
    setCustomPreviewUri(null);
    setTeamError('');
    setCoachError('');
    setSaving(false);
  }, [visible, defaultTeamLogo]);

  const resolvedPreview = customPreviewUri
    || (selectedLogo && !String(selectedLogo).startsWith('default_') ? selectedLogo : null);

  const leagueTitle = String(leagueName || '').trim() || 'lega';
  const canSubmit = useMemo(() => {
    const t = teamName.trim();
    const c = coachName.trim();
    return t.length > 0 && c.length > 0 && !isDefaultTeamName(t) && !isDefaultCoachName(c);
  }, [teamName, coachName]);

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
      showToast('Compila i campi richiesti');
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
        <View style={styles.modalShell}>
          <View style={styles.headerBand}>
            <Text style={styles.eyebrow}>La tua squadra</Text>
            <Text style={styles.title} numberOfLines={2}>
              Benvenuto in {leagueTitle}
            </Text>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            <Text style={styles.sectionLabel}>Scegli il tuo logo</Text>
            <View style={styles.crestTray}>
              <View style={styles.logosGrid}>
                {defaultLogos.map((logo) => {
                  const isSelected = !customPreviewUri && selectedLogo === logo.id;
                  return (
                    <TouchableOpacity
                      key={logo.id}
                      style={[
                        styles.logoItem,
                        { backgroundColor: `${logo.color}20` },
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
                    customPreviewUri ? styles.logoItemSelected : null,
                  ]}
                  onPress={pickCustomLogo}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {resolvedPreview ? (
                    <Image source={{ uri: resolvedPreview }} style={styles.logoCustomImage} />
                  ) : (
                    <Ionicons name="add" size={26} color="#667eea" />
                  )}
                  {customPreviewUri ? (
                    <View style={styles.logoCheck}>
                      <Ionicons name="checkmark-circle" size={16} color="#2e7d32" />
                    </View>
                  ) : null}
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.fieldsCard, (teamError || coachError) ? styles.fieldsCardError : null]}>
              <View style={styles.fieldRow}>
                <View style={styles.fieldIcon}>
                  <Ionicons name="shirt-outline" size={18} color="#667eea" />
                </View>
                <View style={styles.fieldBody}>
                  <Text style={styles.fieldLabel}>Nome squadra</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={teamName}
                    onChangeText={(value) => {
                      setTeamName(value);
                      if (teamError) setTeamError('');
                    }}
                    placeholder="Es. FC Pantere"
                    placeholderTextColor="#a0a4b0"
                    autoCapitalize="words"
                    editable={!saving}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => coachInputRef.current?.focus()}
                  />
                </View>
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <View style={styles.fieldIcon}>
                  <Ionicons name="person-outline" size={18} color="#667eea" />
                </View>
                <View style={styles.fieldBody}>
                  <Text style={styles.fieldLabel}>Allenatore</Text>
                  <TextInput
                    ref={coachInputRef}
                    style={styles.fieldInput}
                    value={coachName}
                    onChangeText={(value) => {
                      setCoachName(value);
                      if (coachError) setCoachError('');
                    }}
                    placeholder="Es. Mister Rossi"
                    placeholderTextColor="#a0a4b0"
                    autoCapitalize="words"
                    editable={!saving}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                  />
                </View>
              </View>
            </View>

            {(teamError || coachError) ? (
              <Text style={styles.inlineError}>
                {teamError || coachError}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.saveButton,
                (!canSubmit || saving) && styles.saveButtonDisabled,
              ]}
              onPress={handleSave}
              disabled={saving || !canSubmit}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Continua</Text>
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
    backgroundColor: 'rgba(18, 22, 33, 0.58)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  modalShell: {
    backgroundColor: '#fff',
    borderRadius: 22,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    overflow: 'hidden',
    shadowColor: '#0f121c',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 16,
  },
  headerBand: {
    backgroundColor: '#f4f6fb',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e4e7ef',
  },
  eyebrow: {
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#667eea',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1c1f2a',
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#7a8090',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
  },
  crestTray: {
    backgroundColor: '#f7f8fc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eceef5',
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8b90a0',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginLeft: 2,
  },
  logosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 8,
    rowGap: 8,
  },
  logoItem: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    backgroundColor: '#fff',
    borderStyle: 'dashed',
    borderColor: '#c8cee3',
  },
  logoEmoji: {
    fontSize: 22,
  },
  logoCustomImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  logoCheck: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  fieldsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e6e8ef',
    overflow: 'hidden',
    marginBottom: 10,
  },
  fieldsCardError: {
    borderColor: '#f0b4b0',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldBody: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8b90a0',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1c1f2a',
    paddingVertical: Platform.OS === 'ios' ? 4 : 2,
    paddingHorizontal: 0,
    margin: 0,
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e8eaf1',
    marginLeft: 58,
  },
  inlineError: {
    fontSize: 12,
    fontWeight: '600',
    color: '#d32f2f',
    marginBottom: 8,
    marginLeft: 4,
  },
  saveButton: {
    backgroundColor: '#667eea',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  saveButtonDisabled: {
    opacity: 0.45,
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
