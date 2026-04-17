import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Animated,
  Platform,
  PanResponder,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { leagueService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import BonusIcon from '../components/BonusIcon';

const STEPS = [
  { id: 1, title: 'Informazioni Base', icon: 'information-circle' },
  { id: 2, title: 'Configurazione Squadre', icon: 'people' },
  { id: 3, title: 'Bonus/Malus', icon: 'trophy' },
  { id: 4, title: 'Riepilogo', icon: 'checkmark-circle' },
];
const CREATE_LEAGUE_DRAFT_KEY = 'create_league_draft_v1';

export default function CreateLeagueScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const scrollViewRef = React.useRef(null);
  const inputLayouts = React.useRef({});
  
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const focusedInputRef = useRef(null);
  const focusedInputKey = useRef(null);
  const [validationToast, setValidationToast] = useState('');
  const [toastMsg, setToastMsg] = useState(null);
  const [highlightField, setHighlightField] = useState(null); // campo da evidenziare
  const fieldRefs = useRef({}); // ref per i container dei campi validabili

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };
  
  // Ensure numeroTitolari is always within range 4-11
  useEffect(() => {
    if (formData && formData.numeroTitolari !== undefined) {
      const currentValue = parseInt(formData.numeroTitolari);
      if (!isNaN(currentValue) && (currentValue < 4 || currentValue > 11)) {
        const clampedValue = Math.min(Math.max(currentValue, 4), 11);
        setFormData(prev => ({ ...prev, numeroTitolari: clampedValue.toString() }));
      }
    }
  }, [formData?.numeroTitolari]);
  
  const scrollViewLayoutY = React.useRef(0); // Y assoluta del top dello ScrollView sullo schermo
  const scrollViewVisibleHeight = React.useRef(0);
  const keyboardTopY = React.useRef(0); // Y assoluta del top della tastiera sullo schermo

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (e) => {
      const kbHeight = e.endCoordinates.height;
      keyboardTopY.current = e.endCoordinates.screenY; // top della tastiera (Y assoluta)
      setKeyboardHeight(kbHeight);

      if (focusedInputRef.current && scrollViewRef.current) {
        setTimeout(() => {
          scrollInputIntoView(focusedInputRef.current);
        }, 150);
      }
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      keyboardTopY.current = 0;
      focusedInputRef.current = null;
      focusedInputKey.current = null;
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Scrolla l'input appena sopra la tastiera
  const scrollInputIntoView = (inputNode) => {
    if (!inputNode || !scrollViewRef.current) return;

    // 1) Misuro la posizione dell'input rispetto al contenuto dello ScrollView
    inputNode.measureLayout(
      scrollViewRef.current,
      (x, yInContent, width, inputHeight) => {
        // 2) Misuro dove si trova lo ScrollView sullo schermo
        scrollViewRef.current.measure?.((svX, svY, svW, svH, svPageX, svPageY) => {
          if (svPageY === undefined) return;

          // Altezza visibile dello ScrollView
          const visibleH = svH || scrollViewVisibleHeight.current || 500;
          // Dove finisce la tastiera sullo schermo
          const kbTop = keyboardTopY.current > 0
            ? keyboardTopY.current
            : (Dimensions?.get?.('window')?.height || 800) - (keyboardHeight || 300);

          // L'area visibile sopra la tastiera va da svPageY a kbTop
          const visibleAboveKb = kbTop - svPageY;

          // Il bottom dell'input nel contenuto dello ScrollView
          const inputBottom = yInContent + inputHeight;

          // Voglio che inputBottom sia a visibleAboveKb - margin dal top dello ScrollView
          const margin = 50; // margine sopra la tastiera
          const targetScrollY = inputBottom - visibleAboveKb + margin;

          scrollViewRef.current.scrollTo({
            y: Math.max(0, targetScrollY),
            animated: true,
          });
        });
      },
      () => {} // errore measureLayout ignorato
    );
  };

  // Per i malus: forza il segno negativo quando esci dal campo
  const commitMalusValue = (fieldKey) => {
    const text = formData[fieldKey];
    if (text !== undefined && text !== null && text !== '') {
      const cleaned = String(text).replace(',', '.');
      let num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0) {
        setFormData(prev => ({ ...prev, [fieldKey]: (-num).toString() }));
      }
    }
  };

  const handleInputFocus = (inputKey, inputRef) => {
    focusedInputRef.current = inputRef?.current;
    focusedInputKey.current = inputKey;

    const doScroll = () => {
      if (!inputRef?.current) return;
      scrollInputIntoView(inputRef.current);
    };

    // Prova subito (tastiera potrebbe essere già aperta)
    setTimeout(doScroll, 150);
    // Riprova dopo che la tastiera è sicuramente aperta
    setTimeout(doScroll, 450);
  };

  const inputRefs = {
    step1: {
      name: React.useRef(null),
      accessCode: React.useRef(null),
      initialBudget: React.useRef(null),
    },
    step2: {
      maxPortieri: React.useRef(null),
      maxDifensori: React.useRef(null),
      maxCentrocampisti: React.useRef(null),
      maxAttaccanti: React.useRef(null),
      numeroTitolari: React.useRef(null),
    },
    step3: {
      bonusGoal: React.useRef(null),
      bonusAssist: React.useRef(null),
      bonusPenaltySaved: React.useRef(null),
      bonusCleanSheet: React.useRef(null),
      malusYellowCard: React.useRef(null),
      malusRedCard: React.useRef(null),
      malusGoalsConceded: React.useRef(null),
      malusOwnGoal: React.useRef(null),
      malusPenaltyMissed: React.useRef(null),
    },
  };
  const [formData, setFormData] = useState({
    name: '',
    enableAccessCode: false,
    accessCode: '',
    requireApproval: false,
    initialBudget: '100',
    defaultTime: '20:00',
    maxPortieri: '3',
    maxDifensori: '8',
    maxCentrocampisti: '8',
    maxAttaccanti: '6',
    numeroTitolari: '11',
    autoLineupMode: true,
    enableBonusMalus: true,
    enableGoal: true,
    bonusGoal: '3.0',
    enableAssist: true,
    bonusAssist: '1.0',
    enableYellowCard: true,
    malusYellowCard: '-0.5',
    enableRedCard: true,
    malusRedCard: '-1.0',
    enableGoalsConceded: true,
    malusGoalsConceded: '-1.0',
    enableOwnGoal: true,
    malusOwnGoal: '-2.0',
    enablePenaltyMissed: true,
    malusPenaltyMissed: '-3.0',
    enablePenaltySaved: true,
    bonusPenaltySaved: '3.0',
    enableCleanSheet: true,
    bonusCleanSheet: '1.0',
    linkedToLeagueId: null,
    linkedLeagueName: '',
  });
  
  const [linkToOfficial, setLinkToOfficial] = useState(false);
  const [officialLeagues, setOfficialLeagues] = useState([]);
  const [loadingOfficialLeagues, setLoadingOfficialLeagues] = useState(false);
  
  // Fetch official leagues when toggle is enabled
  const fetchOfficialLeagues = async () => {
    if (officialLeagues.length > 0) return; // Already loaded
    try {
      setLoadingOfficialLeagues(true);
      const response = await leagueService.getAvailableOfficialLeagues();
      setOfficialLeagues(response.data || []);
    } catch (error) {
      console.error('Error fetching official leagues:', error);
      showToast('Impossibile caricare le leghe ufficiali disponibili', 'error');
    } finally {
      setLoadingOfficialLeagues(false);
    }
  };
  
  // Inizializzazione: se ci sono leghe ufficiali selezionabili, abilita il toggle
  // e preseleziona la prima; altrimenti lascia disabilitato.
  useEffect(() => {
    let mounted = true;
    const bootstrapOfficialLeagues = async () => {
      try {
        setLoadingOfficialLeagues(true);
        const response = await leagueService.getAvailableOfficialLeagues();
        if (!mounted) return;
        const leagues = Array.isArray(response.data) ? response.data : [];
        setOfficialLeagues(leagues);
        if (leagues.length > 0) {
          setLinkToOfficial(true);
          setFormData(prev => ({
            ...prev,
            linkedToLeagueId: prev.linkedToLeagueId || leagues[0].id,
            linkedLeagueName: prev.linkedLeagueName || leagues[0].name || '',
          }));
        } else {
          setLinkToOfficial(false);
          setFormData(prev => ({
            ...prev,
            linkedToLeagueId: null,
            linkedLeagueName: '',
          }));
        }
      } catch (error) {
        if (!mounted) return;
        setLinkToOfficial(false);
      } finally {
        if (mounted) setLoadingOfficialLeagues(false);
      }
    };
    bootstrapOfficialLeagues();
    return () => { mounted = false; };
  }, []);

  // Fetch official leagues only if user enables toggle and list is still empty
  useEffect(() => {
    if (linkToOfficial && officialLeagues.length === 0) {
      fetchOfficialLeagues();
    }
  }, [linkToOfficial, officialLeagues.length]);
  
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Ripristina bozza (se presente) per evitare perdita dati tra step/navigazioni.
  useEffect(() => {
    let mounted = true;
    const loadDraft = async () => {
      try {
        const raw = await AsyncStorage.getItem(CREATE_LEAGUE_DRAFT_KEY);
        if (!mounted || !raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.formData && typeof parsed.formData === 'object') {
            setFormData((prev) => ({ ...prev, ...parsed.formData }));
          }
          if (typeof parsed.linkToOfficial === 'boolean') {
            setLinkToOfficial(parsed.linkToOfficial);
          }
          if (Number.isFinite(Number(parsed.currentStep))) {
            const s = Math.min(Math.max(Number(parsed.currentStep), 1), STEPS.length);
            setCurrentStep(s);
          }
        }
      } catch (_) {
        // Ignore bozza corrotta/non leggibile.
      } finally {
        if (mounted) setDraftLoaded(true);
      }
    };
    loadDraft();
    return () => { mounted = false; };
  }, []);

  // Salva bozza in modo continuo.
  useEffect(() => {
    if (!draftLoaded) return;
    const payload = {
      formData,
      linkToOfficial,
      currentStep,
    };
    AsyncStorage.setItem(CREATE_LEAGUE_DRAFT_KEY, JSON.stringify(payload)).catch(() => {});
  }, [draftLoaded, formData, linkToOfficial, currentStep]);
  
  // Convert defaultTime string to Date object for picker
  const getTimeDate = () => {
    const [hours, minutes] = formData.defaultTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours || 20, minutes || 0, 0, 0);
    return date;
  };
  
  const handleTimeChange = (event, selectedTime) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selectedTime) {
      const hours = selectedTime.getHours().toString().padStart(2, '0');
      const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
      setFormData({ ...formData, defaultTime: `${hours}:${minutes}` });
    }
  };
  
  const handleSliderChange = (value) => {
    const clampedValue = Math.min(Math.max(value, 0), 1000);
    setFormData((prev) => ({ ...prev, initialBudget: clampedValue.toString() }));
  };
  
  const sliderTrackRef = useRef(null);
  const sliderWidth = useRef(300);
  
  const updateSliderValue = (pageX) => {
    if (sliderTrackRef.current) {
      sliderTrackRef.current.measure((x, y, width, height, pageXTrack, pageY) => {
        sliderWidth.current = width;
        const touchX = pageX - pageXTrack;
        const percentage = Math.min(Math.max(touchX / width, 0), 1);
        const value = Math.round(percentage * 1000);
        handleSliderChange(value);
      });
    }
  };
  
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        updateSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => {
        updateSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const handleTitolariChange = (value) => {
    const clampedValue = Math.min(Math.max(value, 4), 11);
    setFormData((prev) => ({ ...prev, numeroTitolari: clampedValue.toString() }));
  };
  
  const titolariSliderTrackRef = useRef(null);
  const titolariSliderWidth = useRef(300);
  
  const updateTitolariSliderValue = (pageX) => {
    if (titolariSliderTrackRef.current) {
      titolariSliderTrackRef.current.measure((x, y, width, height, pageXTrack, pageY) => {
        titolariSliderWidth.current = width;
        const touchX = pageX - pageXTrack;
        const percentage = Math.min(Math.max(touchX / width, 0), 1);
        // Map from 0-1 to 4-11 (7 possible values: 4,5,6,7,8,9,10,11)
        const value = Math.round(4 + (percentage * 7));
        // Ensure value is within range
        const clampedValue = Math.min(Math.max(value, 4), 11);
        handleTitolariChange(clampedValue);
      });
    }
  };
  
  const titolariPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        updateTitolariSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => {
        updateTitolariSliderValue(evt.nativeEvent.pageX);
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const showValidationError = (message, fieldKey) => {
    setValidationToast(message);
    setHighlightField(fieldKey);
    setTimeout(() => setValidationToast(''), 2500);
    setTimeout(() => setHighlightField(null), 3000);

    // Scrolla fino al campo problematico
    if (fieldKey && fieldRefs.current[fieldKey] && scrollViewRef.current) {
      fieldRefs.current[fieldKey].measureLayout(
        scrollViewRef.current,
        (x, y) => {
          scrollViewRef.current.scrollTo({ y: Math.max(0, y - 20), animated: true });
        },
        () => {}
      );
    }
  };

  const validateStep = (step) => {
    switch (step) {
      case 1:
        if (!formData.name.trim()) {
          showValidationError('Inserisci il nome della lega', 'name');
          return false;
        }
        if (parseInt(formData.initialBudget) < 1) {
          showValidationError('Il budget iniziale deve essere almeno 1', 'budget');
          return false;
        }
        return true;
      case 2:
        if (linkToOfficial && !formData.linkedToLeagueId) {
          showValidationError('Seleziona una lega ufficiale a cui associarti', 'officialLeague');
          return false;
        }
        return true;
      case 3:
        // Validazione step 3 (opzionale)
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < STEPS.length) {
        setCurrentStep(currentStep + 1);
        // Scroll to top when changing step
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({ y: 0, animated: true });
        }, 100);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      // Scroll to top when changing step
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }, 100);
    }
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      showValidationError('Inserisci il nome della lega', 'name');
      return;
    }

    if (parseInt(formData.initialBudget) < 1) {
      showValidationError('Il budget iniziale deve essere almeno 1', 'budget');
      return;
    }

    setLoading(true);
    try {
      const toInt = (value, fallback) => {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : fallback;
      };
      const toFloat = (value, fallback) => {
        const n = parseFloat(String(value ?? '').replace(',', '.'));
        return Number.isFinite(n) ? n : fallback;
      };
      const linkedLeagueId = linkToOfficial ? toInt(formData.linkedToLeagueId, 0) : 0;

      const leagueData = {
        name: formData.name.trim(),
        accessCode: formData.enableAccessCode ? (formData.accessCode.trim() || null) : null,
        requireApproval: formData.requireApproval ? 1 : 0,
        initialBudget: Math.max(1, toInt(formData.initialBudget, 100)),
        defaultTime: formData.defaultTime,
        maxPortieri: Math.max(1, toInt(formData.maxPortieri, 3)),
        maxDifensori: Math.max(1, toInt(formData.maxDifensori, 8)),
        maxCentrocampisti: Math.max(1, toInt(formData.maxCentrocampisti, 8)),
        maxAttaccanti: Math.max(1, toInt(formData.maxAttaccanti, 6)),
        numeroTitolari: Math.min(11, Math.max(4, toInt(formData.numeroTitolari, 11))),
        autoLineupMode: formData.autoLineupMode ? 1 : 0,
        linked_to_league_id: linkedLeagueId > 0 ? linkedLeagueId : null,
        bonusSettings: formData.enableBonusMalus ? {
          enable_bonus_malus: 1,
          enable_goal: formData.enableGoal ? 1 : 0,
          bonus_goal: toFloat(formData.bonusGoal, 3.0),
          enable_assist: formData.enableAssist ? 1 : 0,
          bonus_assist: toFloat(formData.bonusAssist, 1.0),
          enable_yellow_card: formData.enableYellowCard ? 1 : 0,
          malus_yellow_card: toFloat(formData.malusYellowCard, -0.5),
          enable_red_card: formData.enableRedCard ? 1 : 0,
          malus_red_card: toFloat(formData.malusRedCard, -1.0),
          enable_goals_conceded: formData.enableGoalsConceded ? 1 : 0,
          malus_goals_conceded: toFloat(formData.malusGoalsConceded, -1.0),
          enable_own_goal: formData.enableOwnGoal ? 1 : 0,
          malus_own_goal: toFloat(formData.malusOwnGoal, -2.0),
          enable_penalty_missed: formData.enablePenaltyMissed ? 1 : 0,
          malus_penalty_missed: toFloat(formData.malusPenaltyMissed, -3.0),
          enable_penalty_saved: formData.enablePenaltySaved ? 1 : 0,
          bonus_penalty_saved: toFloat(formData.bonusPenaltySaved, 3.0),
          enable_clean_sheet: formData.enableCleanSheet ? 1 : 0,
          bonus_clean_sheet: toFloat(formData.bonusCleanSheet, 1.0),
        } : null,
      };

      const response = await leagueService.create(leagueData);
      const createdLeagueId = response?.data?.id || response?.data?.leagueId;
      
      if (createdLeagueId) {
        await AsyncStorage.removeItem(CREATE_LEAGUE_DRAFT_KEY).catch(() => {});
        navigation.navigate('League', { leagueId: createdLeagueId });
      } else {
        showToast('Lega creata con successo!', 'success');
        await AsyncStorage.removeItem(CREATE_LEAGUE_DRAFT_KEY).catch(() => {});
        setTimeout(() => navigation.goBack(), 2500);
      }
    } catch (error) {
      const status = error?.response?.status;
      // Fallback robusto: alcuni ambienti creano la lega ma rispondono 500
      // in step secondari. Se succede, cerchiamo la lega appena creata e navighiamo.
      if (status === 500) {
        try {
          const allRes = await leagueService.getAll();
          const allLeagues = Array.isArray(allRes?.data) ? allRes.data : [];
          const wantedName = formData.name.trim().toLowerCase();
          const sameName = allLeagues
            .filter((l) => String(l?.name || '').trim().toLowerCase() === wantedName)
            .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

          const fallbackLeague = sameName[0];
          if (fallbackLeague?.id) {
            showToast('Lega creata con successo!', 'success');
            await AsyncStorage.removeItem(CREATE_LEAGUE_DRAFT_KEY).catch(() => {});
            setTimeout(() => navigation.navigate('League', { leagueId: fallbackLeague.id }), 350);
            return;
          }
        } catch (_) {
          // Se anche il fallback fallisce, mostra errore standard.
        }
      }

      const errorMessage = error.response?.data?.message || error.message || 'Errore durante la creazione della lega';
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const renderStepIndicator = () => {
    return (
      <View style={styles.stepIndicator}>
        {STEPS.map((step, index) => (
          <React.Fragment key={step.id}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  currentStep >= step.id && styles.stepCircleActive,
                ]}
              >
                <Ionicons
                  name={currentStep > step.id ? 'checkmark' : step.icon}
                  size={20}
                  color={currentStep >= step.id ? '#fff' : '#999'}
                />
              </View>
              {currentStep === step.id && (
                <Text style={styles.stepLabel}>{step.title}</Text>
              )}
            </View>
            {index < STEPS.length - 1 && (
              <View
                style={[
                  styles.stepLine,
                  currentStep > step.id && styles.stepLineActive,
                ]}
              />
            )}
          </React.Fragment>
        ))}
      </View>
    );
  };

  const renderStep1 = () => (
    <View style={[styles.stepContent, styles.step1Content]}>
      <Text style={[styles.stepDescription, styles.step1Description]}>
        Imposta le informazioni principali della tua lega
      </Text>

      <View
        ref={(ref) => { fieldRefs.current['name'] = ref; }}
        style={[styles.inputGroup, styles.step1InputGroup, highlightField === 'name' && styles.highlightField]}
      >
        <Text style={[styles.label, styles.step1Label]}>Nome Lega *</Text>
        <TextInput
          ref={inputRefs.step1.name}
          style={[styles.input, styles.step1Input]}
          placeholder="Inserisci nome lega"
          placeholderTextColor="#999"
          value={formData.name}
          onChangeText={(text) => setFormData({ ...formData, name: text })}
          returnKeyType="next"
          onSubmitEditing={() => {
            if (formData.enableAccessCode && inputRefs.step1.accessCode.current) {
              inputRefs.step1.accessCode.current.focus();
            } else {
              inputRefs.step1.initialBudget.current?.focus();
            }
          }}
          onLayout={(event) => {
            const { y } = event.nativeEvent.layout;
            inputLayouts.current['step1.name'] = { y };
          }}
          onFocus={() => handleInputFocus('step1.name', inputRefs.step1.name)}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Codice di Accesso</Text>
            <Text style={styles.labelHint}>
              Richiedi un codice per accedere alla lega
            </Text>
          </View>
          <Switch
            value={formData.enableAccessCode}
            onValueChange={(value) => setFormData({ ...formData, enableAccessCode: value })}
            trackColor={{ false: '#e0e0e0', true: '#667eea' }}
            thumbColor={formData.enableAccessCode ? '#fff' : '#f4f3f4'}
          />
        </View>
        {formData.enableAccessCode && (
          <TextInput
            ref={inputRefs.step1.accessCode}
            style={[styles.input, { marginTop: 8 }]}
            placeholder="Inserisci codice di accesso"
            placeholderTextColor="#999"
            value={formData.accessCode}
            onChangeText={(text) => setFormData({ ...formData, accessCode: text })}
            returnKeyType="next"
            onSubmitEditing={() => inputRefs.step1.initialBudget.current?.focus()}
            onLayout={(event) => {
              const { y } = event.nativeEvent.layout;
              inputLayouts.current['step1.accessCode'] = { y };
            }}
            onFocus={() => handleInputFocus('step1.accessCode', inputRefs.step1.accessCode)}
          />
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Approvazione Iscrizioni</Text>
            <Text style={styles.labelHint}>
              {formData.requireApproval
                ? 'Le richieste di iscrizione devono essere approvate da un admin'
                : 'Chiunque può iscriversi liberamente alla lega'}
            </Text>
          </View>
          <Switch
            value={formData.requireApproval}
            onValueChange={(value) => setFormData({ ...formData, requireApproval: value })}
            trackColor={{ false: '#e0e0e0', true: '#667eea' }}
            thumbColor={formData.requireApproval ? '#fff' : '#f4f3f4'}
          />
        </View>
      </View>

      <View
        ref={(ref) => { fieldRefs.current['budget'] = ref; }}
        style={[styles.inputGroup, styles.step1InputGroup, highlightField === 'budget' && styles.highlightField]}
      >
        <View style={styles.budgetHeader}>
          <Text style={[styles.label, styles.step1Label]}>Budget Iniziale *</Text>
        </View>
        <Text style={[styles.labelHint, styles.step1LabelHint]}>Budget disponibile per ogni utente all'inizio (0-1000)</Text>
        <View style={styles.budgetRow}>
          <View style={[styles.sliderWrapper, styles.step1SliderWrapper]} {...panResponder.panHandlers}>
            <View 
              ref={sliderTrackRef} 
              style={styles.sliderTrack}
              onLayout={(event) => {
                sliderWidth.current = event.nativeEvent.layout.width;
              }}
            >
              <View 
                style={[
                  styles.sliderFill, 
                  { width: `${((parseInt(formData.initialBudget) || 0) / 1000) * 100}%` }
                ]} 
              />
              <View
                style={[
                  styles.sliderThumb,
                  { left: `${((parseInt(formData.initialBudget) || 0) / 1000) * 100}%` }
                ]}
              />
            </View>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>0</Text>
              <Text style={styles.sliderLabel}>1000</Text>
            </View>
          </View>
          <TextInput
            ref={inputRefs.step1.initialBudget}
            style={[styles.input, styles.step1Input, styles.budgetInput]}
            placeholder="100"
            placeholderTextColor="#999"
            keyboardType="numeric"
            value={formData.initialBudget}
            onChangeText={(text) => {
              const numValue = parseInt(text) || 0;
              const clampedValue = Math.min(Math.max(numValue, 0), 1000);
              setFormData({ ...formData, initialBudget: clampedValue.toString() });
            }}
            returnKeyType="done"
            onSubmitEditing={() => {
              handleNext();
            }}
            onLayout={(event) => {
              const { y } = event.nativeEvent.layout;
              inputLayouts.current['step1.initialBudget'] = { y };
            }}
            onFocus={() => handleInputFocus('step1.initialBudget', inputRefs.step1.initialBudget)}
          />
        </View>
      </View>

    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepDescription}>
        Configura struttura e impostazioni della lega
      </Text>

      {/* Associazione a Lega Ufficiale */}
      <View
        ref={(ref) => { fieldRefs.current['officialLeague'] = ref; }}
        style={[styles.card, highlightField === 'officialLeague' && styles.highlightField]}
      >
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="ribbon" size={20} color="#667eea" />
              <Text style={styles.label}>Associa a Lega Ufficiale{linkToOfficial ? ' *' : ''}</Text>
            </View>
            <Text style={styles.labelHint}>
              Giocatori, quotazioni e voti verranno dalla lega ufficiale
            </Text>
          </View>
          <Switch
            value={linkToOfficial}
            onValueChange={(value) => {
              setLinkToOfficial(value);
              if (value) {
                fetchOfficialLeagues();
              } else {
                setFormData(prev => ({ ...prev, linkedToLeagueId: null, linkedLeagueName: '' }));
              }
            }}
            trackColor={{ false: '#e0e0e0', true: '#667eea' }}
            thumbColor={linkToOfficial ? '#fff' : '#f4f3f4'}
          />
        </View>
        
        {linkToOfficial && (
          <View style={{ paddingHorizontal: 0, paddingTop: 12 }}>
            {loadingOfficialLeagues ? (
              <ActivityIndicator size="small" color="#667eea" style={{ padding: 16 }} />
            ) : officialLeagues.length === 0 ? (
              <Text style={{ fontSize: 14, color: '#999', textAlign: 'center', padding: 16 }}>
                Nessuna lega ufficiale disponibile
              </Text>
            ) : (
              officialLeagues.map((league) => {
                const isSelected = formData.linkedToLeagueId === league.id;
                return (
                  <TouchableOpacity
                    key={league.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 12,
                      marginBottom: 8,
                      borderRadius: 8,
                      backgroundColor: isSelected ? '#eef0ff' : '#f9f9f9',
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? '#667eea' : '#e0e0e0',
                    }}
                    onPress={() => {
                      if (isSelected) {
                        setFormData(prev => ({ ...prev, linkedToLeagueId: null, linkedLeagueName: '' }));
                      } else {
                        setFormData(prev => ({ ...prev, linkedToLeagueId: league.id, linkedLeagueName: league.name }));
                      }
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 2 }}>
                        {league.name}
                      </Text>
                      {league.official_group_name && (
                        <Text style={{ fontSize: 12, color: '#667eea', marginBottom: 2 }}>
                          {league.official_group_name}
                        </Text>
                      )}
                      <Text style={{ fontSize: 12, color: '#999' }}>
                        {league.team_count} squadre • {league.player_count} giocatori • {league.matchday_count} giornate
                      </Text>
                    </View>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={isSelected ? '#667eea' : '#ccc'}
                    />
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardTitleContainer}>
          <Text style={styles.cardTitle}>Limiti Giocatori per Ruolo</Text>
        </View>
        <View style={styles.roleLimitsRow}>
          <View style={[styles.roleLimitItem, styles.roleLimitItemFirst]}>
            <Text style={styles.roleLimitLabel}>Portieri</Text>
            <TextInput
              ref={inputRefs.step2.maxPortieri}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxPortieri}
              onChangeText={(text) => setFormData({ ...formData, maxPortieri: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.maxDifensori.current?.focus()}
              onLayout={(event) => {
                const { y } = event.nativeEvent.layout;
                inputLayouts.current['step2.maxPortieri'] = { y };
              }}
              onFocus={() => handleInputFocus('step2.maxPortieri', inputRefs.step2.maxPortieri)}
            />
          </View>
          <View style={styles.roleLimitSeparator} />
          <View style={styles.roleLimitItem}>
            <Text style={styles.roleLimitLabel}>Difensori</Text>
            <TextInput
              ref={inputRefs.step2.maxDifensori}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxDifensori}
              onChangeText={(text) => setFormData({ ...formData, maxDifensori: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.maxCentrocampisti.current?.focus()}
              onLayout={(event) => {
                const { y } = event.nativeEvent.layout;
                inputLayouts.current['step2.maxDifensori'] = { y };
              }}
              onFocus={() => handleInputFocus('step2.maxDifensori', inputRefs.step2.maxDifensori)}
            />
          </View>
          <View style={styles.roleLimitSeparator} />
          <View style={styles.roleLimitItem}>
            <Text style={styles.roleLimitLabel}>Centrocampisti</Text>
            <TextInput
              ref={inputRefs.step2.maxCentrocampisti}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxCentrocampisti}
              onChangeText={(text) => setFormData({ ...formData, maxCentrocampisti: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.maxAttaccanti.current?.focus()}
              onLayout={(event) => {
                const { y } = event.nativeEvent.layout;
                inputLayouts.current['step2.maxCentrocampisti'] = { y };
              }}
              onFocus={() => handleInputFocus('step2.maxCentrocampisti', inputRefs.step2.maxCentrocampisti)}
            />
          </View>
          <View style={styles.roleLimitSeparator} />
          <View style={[styles.roleLimitItem, styles.roleLimitItemLast]}>
            <Text style={styles.roleLimitLabel}>Attaccanti</Text>
            <TextInput
              ref={inputRefs.step2.maxAttaccanti}
              style={styles.roleLimitInput}
              keyboardType="numeric"
              value={formData.maxAttaccanti}
              onChangeText={(text) => setFormData({ ...formData, maxAttaccanti: text })}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step2.numeroTitolari.current?.focus()}
              onLayout={(event) => {
                const { y } = event.nativeEvent.layout;
                inputLayouts.current['step2.maxAttaccanti'] = { y };
              }}
              onFocus={() => handleInputFocus('step2.maxAttaccanti', inputRefs.step2.maxAttaccanti)}
            />
          </View>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <View style={styles.budgetHeader}>
          <Text style={styles.label}>Numero Titolari in Campo</Text>
        </View>
        <View style={styles.budgetRow}>
          <View style={[styles.sliderWrapper, styles.step1SliderWrapper]} {...titolariPanResponder.panHandlers}>
            <View 
              ref={titolariSliderTrackRef} 
              style={styles.sliderTrack}
              onLayout={(event) => {
                titolariSliderWidth.current = event.nativeEvent.layout.width;
              }}
            >
              <View 
                style={[
                  styles.sliderFill, 
                  { width: `${(((Math.min(Math.max(parseInt(formData.numeroTitolari) || 11, 4), 11)) - 4) / 7) * 100}%` }
                ]} 
              />
              <View
                style={[
                  styles.sliderThumb,
                  { left: `${(((Math.min(Math.max(parseInt(formData.numeroTitolari) || 11, 4), 11)) - 4) / 7) * 100}%` }
                ]}
              />
            </View>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>4</Text>
              <Text style={styles.sliderLabel}>11</Text>
            </View>
          </View>
          <TextInput
            ref={inputRefs.step2.numeroTitolari}
            style={[styles.input, styles.step1Input, styles.budgetInput]}
            keyboardType="numeric"
            value={formData.numeroTitolari}
            onChangeText={(text) => {
              // Allow free editing, only validate on blur/submit
              if (text === '' || /^\d*$/.test(text)) {
                setFormData({ ...formData, numeroTitolari: text });
              }
            }}
            onBlur={() => {
              // Validate and correct when leaving the field
              const numValue = parseInt(formData.numeroTitolari);
              if (isNaN(numValue) || numValue < 4 || numValue > 11) {
                const clampedValue = Math.min(Math.max(isNaN(numValue) ? 11 : numValue, 4), 11);
                setFormData(prev => ({ ...prev, numeroTitolari: clampedValue.toString() }));
              }
            }}
            returnKeyType="done"
            onSubmitEditing={() => {
              // Validate and correct when pressing done
              const numValue = parseInt(formData.numeroTitolari);
              if (isNaN(numValue) || numValue < 4 || numValue > 11) {
                const clampedValue = Math.min(Math.max(isNaN(numValue) ? 11 : numValue, 4), 11);
                setFormData(prev => ({ ...prev, numeroTitolari: clampedValue.toString() }));
              }
              handleNext();
            }}
            onLayout={(event) => {
              const { y } = event.nativeEvent.layout;
              inputLayouts.current['step2.numeroTitolari'] = { y };
            }}
            onFocus={() => handleInputFocus('step2.numeroTitolari', inputRefs.step2.numeroTitolari)}
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.switchGroup}>
          <View style={styles.switchInfo}>
            <Text style={styles.label}>Formazione Automatica</Text>
            <Text style={styles.labelHint}>
              Se abilitata, la formazione viene impostata automaticamente
            </Text>
          </View>
          <Switch
            value={formData.autoLineupMode}
            onValueChange={(value) => setFormData({ ...formData, autoLineupMode: value })}
            trackColor={{ false: '#e0e0e0', true: '#667eea' }}
            thumbColor={formData.autoLineupMode ? '#fff' : '#f4f3f4'}
          />
        </View>

        {/* Orario default scadenza - visibile solo se formazione automatica è disabilitata */}
        {!formData.autoLineupMode && (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.label}>Orario Default Scadenza</Text>
            <Text style={styles.labelHint}>Orario predefinito per le scadenze delle formazioni</Text>
            <TouchableOpacity
              style={styles.timePickerButton}
              onPress={() => setShowTimePicker(true)}
            >
              <Ionicons name="time-outline" size={20} color="#667eea" />
              <Text style={styles.timePickerText}>{formData.defaultTime}</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            {showTimePicker && (
              <DateTimePicker
                value={getTimeDate()}
                mode="time"
                is24Hour={true}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleTimeChange}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepDescription}>
        Configura i bonus e i malus per gli eventi di gioco
      </Text>

      {/* Header con switch abilitazione */}
      <View style={styles.bmFormGroup}>
        <View style={styles.bmLabelContainer}>
          <Ionicons name="trophy-outline" size={18} color="#667eea" style={styles.bmLabelIcon} />
          <Text style={styles.bmLabel}>Bonus/Malus</Text>
          <Switch
            value={formData.enableBonusMalus}
            onValueChange={(value) => setFormData({ ...formData, enableBonusMalus: value })}
            trackColor={{ false: '#e0e0e0', true: '#667eea' }}
            thumbColor={formData.enableBonusMalus ? '#fff' : '#f4f3f4'}
            style={{ marginLeft: 'auto' }}
          />
        </View>
        <Text style={styles.bmSubtitle}>Abilita o disabilita il sistema bonus/malus per la lega</Text>
      </View>

      {formData.enableBonusMalus && (
        <>
          {/* ===== SEZIONE BONUS ===== */}
          <Text style={styles.bmSectionTitle}>Bonus</Text>

          {/* Goal segnato */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="goal" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Goal segnato</Text>
            <Switch
              value={formData.enableGoal}
              onValueChange={(value) => setFormData({ ...formData, enableGoal: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableGoal ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusGoal}
              style={[styles.bmRowInput, !formData.enableGoal && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusGoal}
              onChangeText={(text) => setFormData({ ...formData, bonusGoal: text })}
              placeholder="3.0"
              placeholderTextColor="#999"
              editable={formData.enableGoal}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusAssist.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusGoal'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusGoal', inputRefs.step3.bonusGoal)}
            />
          </View>

          {/* Assist */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="assist" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Assist</Text>
            <Switch
              value={formData.enableAssist}
              onValueChange={(value) => setFormData({ ...formData, enableAssist: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableAssist ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusAssist}
              style={[styles.bmRowInput, !formData.enableAssist && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusAssist}
              onChangeText={(text) => setFormData({ ...formData, bonusAssist: text })}
              placeholder="1.0"
              placeholderTextColor="#999"
              editable={formData.enableAssist}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusPenaltySaved?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusAssist'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusAssist', inputRefs.step3.bonusAssist)}
            />
          </View>

          {/* Rigore parato */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="penalty_saved" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Rigore parato</Text>
            <Switch
              value={formData.enablePenaltySaved}
              onValueChange={(value) => setFormData({ ...formData, enablePenaltySaved: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enablePenaltySaved ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusPenaltySaved}
              style={[styles.bmRowInput, !formData.enablePenaltySaved && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusPenaltySaved}
              onChangeText={(text) => setFormData({ ...formData, bonusPenaltySaved: text })}
              placeholder="3.0"
              placeholderTextColor="#999"
              editable={formData.enablePenaltySaved}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.bonusCleanSheet?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusPenaltySaved'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusPenaltySaved', inputRefs.step3.bonusPenaltySaved)}
            />
          </View>

          {/* Clean sheet */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="clean_sheet" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Clean sheet</Text>
            <Switch
              value={formData.enableCleanSheet}
              onValueChange={(value) => setFormData({ ...formData, enableCleanSheet: value })}
              trackColor={{ false: '#e0e0e0', true: '#4CAF50' }}
              thumbColor={formData.enableCleanSheet ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.bonusCleanSheet}
              style={[styles.bmRowInput, !formData.enableCleanSheet && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.bonusCleanSheet}
              onChangeText={(text) => setFormData({ ...formData, bonusCleanSheet: text })}
              placeholder="1.0"
              placeholderTextColor="#999"
              editable={formData.enableCleanSheet}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusYellowCard?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.bonusCleanSheet'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.bonusCleanSheet', inputRefs.step3.bonusCleanSheet)}
            />
          </View>

          {/* ===== SEZIONE MALUS ===== */}
          <Text style={styles.bmSectionTitle}>Malus</Text>

          {/* Cartellino giallo */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="yellow_card" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Cartellino giallo</Text>
            <Switch
              value={formData.enableYellowCard}
              onValueChange={(value) => setFormData({ ...formData, enableYellowCard: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableYellowCard ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusYellowCard}
              style={[styles.bmRowInput, !formData.enableYellowCard && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusYellowCard}
              onChangeText={(text) => setFormData({ ...formData, malusYellowCard: text })}
              onBlur={() => commitMalusValue('malusYellowCard')}
              placeholder="-0.5"
              placeholderTextColor="#999"
              editable={formData.enableYellowCard}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusRedCard?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusYellowCard'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusYellowCard', inputRefs.step3.malusYellowCard)}
            />
          </View>

          {/* Cartellino rosso */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="red_card" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Cartellino rosso</Text>
            <Switch
              value={formData.enableRedCard}
              onValueChange={(value) => setFormData({ ...formData, enableRedCard: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableRedCard ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusRedCard}
              style={[styles.bmRowInput, !formData.enableRedCard && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusRedCard}
              onChangeText={(text) => setFormData({ ...formData, malusRedCard: text })}
              onBlur={() => commitMalusValue('malusRedCard')}
              placeholder="-1.0"
              placeholderTextColor="#999"
              editable={formData.enableRedCard}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusGoalsConceded?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusRedCard'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusRedCard', inputRefs.step3.malusRedCard)}
            />
          </View>

          {/* Goal subito */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="goals_conceded" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Goal subito</Text>
            <Switch
              value={formData.enableGoalsConceded}
              onValueChange={(value) => setFormData({ ...formData, enableGoalsConceded: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableGoalsConceded ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusGoalsConceded}
              style={[styles.bmRowInput, !formData.enableGoalsConceded && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusGoalsConceded}
              onChangeText={(text) => setFormData({ ...formData, malusGoalsConceded: text })}
              onBlur={() => commitMalusValue('malusGoalsConceded')}
              placeholder="-1.0"
              placeholderTextColor="#999"
              editable={formData.enableGoalsConceded}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusOwnGoal?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusGoalsConceded'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusGoalsConceded', inputRefs.step3.malusGoalsConceded)}
            />
          </View>

          {/* Autogoal */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="own_goal" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Autogoal</Text>
            <Switch
              value={formData.enableOwnGoal}
              onValueChange={(value) => setFormData({ ...formData, enableOwnGoal: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enableOwnGoal ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusOwnGoal}
              style={[styles.bmRowInput, !formData.enableOwnGoal && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusOwnGoal}
              onChangeText={(text) => setFormData({ ...formData, malusOwnGoal: text })}
              onBlur={() => commitMalusValue('malusOwnGoal')}
              placeholder="-2.0"
              placeholderTextColor="#999"
              editable={formData.enableOwnGoal}
              returnKeyType="next"
              onSubmitEditing={() => inputRefs.step3.malusPenaltyMissed?.current?.focus()}
              onLayout={(e) => { inputLayouts.current['step3.malusOwnGoal'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusOwnGoal', inputRefs.step3.malusOwnGoal)}
            />
          </View>

          {/* Rigore sbagliato */}
          <View style={styles.bmRowFull}>
            <View style={styles.bmRowIcon}><BonusIcon type="penalty_missed" size={20} /></View>
            <Text style={styles.bmRowLabel} numberOfLines={1}>Rigore sbagliato</Text>
            <Switch
              value={formData.enablePenaltyMissed}
              onValueChange={(value) => setFormData({ ...formData, enablePenaltyMissed: value })}
              trackColor={{ false: '#e0e0e0', true: '#e53935' }}
              thumbColor={formData.enablePenaltyMissed ? '#fff' : '#f4f3f4'}
              style={styles.bmRowSwitch}
            />
            <TextInput
              ref={inputRefs.step3.malusPenaltyMissed}
              style={[styles.bmRowInput, !formData.enablePenaltyMissed && styles.bmRowInputDisabled]}
              keyboardType="decimal-pad"
              value={formData.malusPenaltyMissed}
              onChangeText={(text) => setFormData({ ...formData, malusPenaltyMissed: text })}
              onBlur={() => commitMalusValue('malusPenaltyMissed')}
              placeholder="-3.0"
              placeholderTextColor="#999"
              editable={formData.enablePenaltyMissed}
              returnKeyType="done"
              onSubmitEditing={handleNext}
              onLayout={(e) => { inputLayouts.current['step3.malusPenaltyMissed'] = { y: e.nativeEvent.layout.y }; }}
              onFocus={() => handleInputFocus('step3.malusPenaltyMissed', inputRefs.step3.malusPenaltyMissed)}
            />
          </View>
        </>
      )}
    </View>
  );

  const renderStep4 = () => (
    <View style={styles.stepContent}>
     
      <View style={styles.summaryCard}>
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Informazioni Base</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Nome</Text>
            <Text style={styles.summaryValue}>{formData.name || 'Non impostato'}</Text>
          </View>
          {formData.enableAccessCode && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Codice</Text>
              <Text style={styles.summaryValue}>{formData.accessCode || 'Non impostato'}</Text>
            </View>
          )}
          {formData.requireApproval && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Approvazione</Text>
              <Text style={styles.summaryValue}>Richiesta</Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Budget</Text>
            <Text style={styles.summaryValue}>{formData.initialBudget}</Text>
          </View>
        </View>

        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Squadra</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Ruoli</Text>
            <Text style={styles.summaryValue}>
              P:{formData.maxPortieri} D:{formData.maxDifensori} C:{formData.maxCentrocampisti} A:{formData.maxAttaccanti}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Titolari</Text>
            <Text style={styles.summaryValue}>{formData.numeroTitolari}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Formazione Auto</Text>
            <Text style={styles.summaryValue}>
              {formData.autoLineupMode ? 'Si' : 'No'}
            </Text>
          </View>
          {!formData.autoLineupMode && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Orario Scadenza</Text>
              <Text style={styles.summaryValue}>{formData.defaultTime}</Text>
            </View>
          )}
          {formData.linkedToLeagueId && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Lega Ufficiale</Text>
              <Text style={[styles.summaryValue, { color: '#667eea', fontWeight: '600' }]}>
                {formData.linkedLeagueName}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.summarySection, { marginBottom: 0 }]}>
          <Text style={styles.summaryTitle}>Bonus/Malus</Text>
          {!formData.enableBonusMalus ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Sistema</Text>
              <Text style={styles.summaryValue}>Disabilitato</Text>
            </View>
          ) : (
            <View style={styles.summaryBonusWrap}>
              {formData.enableGoal && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="goal" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusGoal}</Text>
                </View></View>
              )}
              {formData.enableAssist && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="assist" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusAssist}</Text>
                </View></View>
              )}
              {formData.enablePenaltySaved && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="penalty_saved" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusPenaltySaved}</Text>
                </View></View>
              )}
              {formData.enableCleanSheet && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="clean_sheet" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#4CAF50' }]}>+{formData.bonusCleanSheet}</Text>
                </View></View>
              )}
              {formData.enableYellowCard && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="yellow_card" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusYellowCard}</Text>
                </View></View>
              )}
              {formData.enableRedCard && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="red_card" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusRedCard}</Text>
                </View></View>
              )}
              {formData.enableGoalsConceded && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="goals_conceded" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusGoalsConceded}</Text>
                </View></View>
              )}
              {formData.enableOwnGoal && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="own_goal" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusOwnGoal}</Text>
                </View></View>
              )}
              {formData.enablePenaltyMissed && (
                <View style={styles.summaryBonusChip}><View style={styles.summaryBonusChipInner}>
                  <BonusIcon type="penalty_missed" size={16} />
                  <Text style={[styles.summaryBonusVal, { color: '#e53935' }]}>{formData.malusPenaltyMissed}</Text>
                </View></View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      default:
        return renderStep1();
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Crea Nuova Lega</Text>
        <View style={{ width: 40 }} />
      </View>

      {renderStepIndicator()}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoidingView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={{ paddingBottom: 200 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onLayout={(e) => { scrollViewVisibleHeight.current = e.nativeEvent.layout.height; }}
        >
          {renderCurrentStep()}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
        {currentStep > 1 && (
          <TouchableOpacity style={styles.footerButtonSecondary} onPress={handleBack}>
            <Ionicons name="arrow-back" size={20} color="#667eea" />
            <Text style={styles.footerButtonSecondaryText}>Indietro</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        {currentStep < STEPS.length ? (
          <TouchableOpacity style={styles.footerButton} onPress={handleNext}>
            <Text style={styles.footerButtonText}>Avanti</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.footerButton, styles.footerButtonPrimary, loading && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.footerButtonText}>Crea Lega</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Toast di validazione */}
      {validationToast !== '' && (
        <View style={styles.validationToast}>
          <Ionicons name="alert-circle" size={18} color="#fff" />
          <Text style={styles.validationToastText}>{validationToast}</Text>
        </View>
      )}

      {/* Toast generico (success/error) */}
      {toastMsg && (
        <View style={[styles.generalToast, toastMsg.type === 'success' ? styles.generalToastSuccess : styles.generalToastError]}>
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.generalToastText}>{toastMsg.text}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  stepItem: {
    alignItems: 'center',
    minWidth: 60,
  },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  stepCircleActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  stepLabel: {
    fontSize: 10,
    color: '#667eea',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 8,
    maxWidth: 40,
  },
  stepLineActive: {
    backgroundColor: '#667eea',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  stepContent: {
    padding: 20,
  },
  step1Content: {
    padding: 16,
  },
  step1Description: {
    marginBottom: 12,
  },
  step1InputGroup: {
    marginBottom: 12,
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 12,
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  budgetHeader: {
    marginBottom: 4,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  sliderWrapper: {
    flex: 1,
    marginVertical: 12,
  },
  step1SliderWrapper: {
    marginVertical: 8,
  },
  sliderTrack: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    position: 'relative',
    marginBottom: 8,
  },
  sliderFill: {
    height: 6,
    backgroundColor: '#667eea',
    borderRadius: 3,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  sliderThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#667eea',
    position: 'absolute',
    top: -7,
    marginLeft: -10,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontSize: 12,
    color: '#999',
  },
  budgetInput: {
    width: 80,
    marginTop: 0,
    marginBottom: 12,
  },
  timePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    gap: 12,
  },
  step1TimePickerButton: {
    padding: 12,
  },
  timePickerText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  step1Label: {
    fontSize: 15,
    marginBottom: 6,
  },
  labelHint: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  step1LabelHint: {
    fontSize: 11,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  halfInput: {
    flex: 1,
  },
  cardTitleContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  roleLimitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    marginHorizontal: -16,
  },
  roleLimitItem: {
    flex: 1,
    alignItems: 'center',
  },
  roleLimitLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    textAlign: 'center',
  },
  roleLimitItemFirst: {
    paddingLeft: 0,
  },
  roleLimitItemLast: {
    paddingRight: 0,
  },
  roleLimitInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
    textAlign: 'center',
    minWidth: 50,
  },
  roleLimitSeparator: {
    width: 1,
    height: 40,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 1,
  },
  switchGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  switchInfo: {
    flex: 1,
    marginRight: 12,
  },
  bonusSection: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  bonusGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  bonusGridItem: {
    flex: 1,
    backgroundColor: '#fafafa',
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 10,
  },
  bmFormGroup: {
    marginBottom: 16,
  },
  bmFormGroupRow: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  bmFormGroupHalf: {
    flex: 1,
  },
  bmFormGroupSeparator: {
    width: 1,
    backgroundColor: '#ddd',
    marginHorizontal: 8,
    alignSelf: 'stretch',
  },
  bmLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  bmLabelIcon: {
    marginRight: 4,
  },
  bmLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    flexShrink: 1,
  },
  bmSubtitle: {
    fontSize: 11,
    color: '#666',
    marginBottom: 8,
    marginLeft: 24,
  },
  bmSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#667eea',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  bmSwitch: {
    marginLeft: 'auto',
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  bmRowFull: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  bmRowIcon: {
    width: 28,
    alignItems: 'center',
    marginRight: 10,
  },
  bmRowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  bmRowSwitch: {
    marginHorizontal: 8,
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  bmRowInput: {
    width: 62,
    height: 38,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    backgroundColor: '#f8f9fa',
    paddingVertical: 0,
    paddingHorizontal: 4,
    includeFontPadding: false,
  },
  bmRowInputDisabled: {
    opacity: 0.4,
    backgroundColor: '#f0f0f0',
  },
  bmCardIcon: {
    width: 14,
    height: 20,
    borderRadius: 2,
    marginRight: 6,
  },
  bmInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    color: '#333',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summarySection: {
    marginBottom: 14,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  summaryBonusWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginHorizontal: -3,
  },
  summaryBonusChip: {
    width: '25%',
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  summaryBonusChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  summaryBonusVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 5,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    minWidth: 120,
  },
  footerButtonPrimary: {
    backgroundColor: '#4CAF50',
  },
  footerButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    marginRight: 12,
  },
  footerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footerButtonSecondaryText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  highlightField: {
    borderWidth: 2,
    borderColor: '#e53935',
    borderRadius: 12,
    backgroundColor: '#fff5f5',
  },
  validationToast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: '#e53935',
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
  validationToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  generalToast: {
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
  generalToastError: {
    backgroundColor: '#e53935',
  },
  generalToastSuccess: {
    backgroundColor: '#4CAF50',
  },
  generalToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
