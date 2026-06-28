import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import KnockoutSemiTieBlock from './KnockoutSemiTieBlock';
import { KnockoutScoreText, hasKnockoutShootoutScore } from './KnockoutSemiTieBlock';
import {
  EMPTY_OFFICIAL_KNOCKOUT,
  groupQuarterfinalsIntoTies,
  groupSemifinalsIntoTies,
  KNOCKOUT_BRACKET_LOGO_SIZE,
} from '../utils/knockoutBracket';

function KnockoutStraightConnector({ flowTall, layout, quarterTies = [], lineCentersY = null }) {
  const ties = quarterTies.length > 0 ? quarterTies : [{ twoLegged: false }];
  const measured =
    Array.isArray(lineCentersY) &&
    lineCentersY.length === ties.length &&
    lineCentersY.every((y) => Number.isFinite(y) && y >= 0);

  if (measured) {
    const colHeight = Math.max(...lineCentersY) + 8;
    const colWidth = flowTall && layout.flowColCompact ? 28 : 56;
    return (
      <View
        style={[
          layout.flowColStraightStack,
          flowTall && layout.flowColCompact,
          {
            position: 'relative',
            height: colHeight,
            width: colWidth,
            gap: 0,
          },
        ]}
      >
        {ties.map((tie, idx) => (
          <View
            key={`q-flow-line-${idx}`}
            style={{
              position: 'absolute',
              top: lineCentersY[idx] - 0.5,
              left: 0,
              width: colWidth,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={[
                layout.flowStraightLine,
                flowTall && layout.flowStraightLineTall,
                flowTall && layout.flowColCompact && layout.flowStraightLineCompact,
              ]}
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      style={[
        layout.flowColStraightStack,
        flowTall && layout.flowColStraightStackTall,
        flowTall && layout.flowColCompact,
      ]}
    >
      <View style={layout.flowStraightHeaderSpacer} />
      {ties.map((tie, idx) => (
        <View
          key={`q-flow-line-${idx}`}
          style={[
            layout.flowStraightTieSlot,
            tie?.twoLegged && layout.flowStraightTieSlotTall,
            idx === 0 && layout.flowStraightFirstTieSlot,
            idx === 1 && layout.flowStraightSecondTieSlot,
            tie?.twoLegged && idx === 1 && layout.flowStraightSecondTieSlotTall,
          ]}
        >
          <View
            style={[
              layout.flowStraightLine,
              flowTall && layout.flowStraightLineTall,
              flowTall && layout.flowColCompact && layout.flowStraightLineCompact,
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function KnockoutFlowConnector({
  flowTall,
  layout,
  quarterTies = [],
  quarterLineCentersY = null,
  afterQuarters = false,
  afterSemis = false,
  withQuarterfinals = false,
}) {
  if (afterQuarters) {
    return (
      <KnockoutStraightConnector
        flowTall={flowTall}
        layout={layout}
        quarterTies={quarterTies}
        lineCentersY={quarterLineCentersY}
      />
    );
  }

  const {
    flowCol,
    flowColTall,
    flowColCompact,
    flowColSemiFinal,
    flowColSemiFinalTall,
    topArm,
    topArmCompact,
    topArmCompactTall,
    bottomArm,
    bottomArmCompact,
    bottomArmCompactTall,
    vertical,
    verticalCompact,
    verticalCompactTall,
    middleArm,
    middleArmCompact,
    middleArmCompactTall,
    middleArmSemiFinal,
    middleArmSemiFinalTall,
  } = layout;
  return (
    <View
      style={[
        flowCol,
        flowTall && flowColTall,
        flowTall && flowColCompact,
        afterSemis && withQuarterfinals && flowColSemiFinal,
        afterSemis && withQuarterfinals && flowTall && flowColSemiFinalTall,
      ]}
    >
      <View style={[topArm, flowTall && topArmCompact, flowTall && topArmCompactTall]} />
      <View style={[bottomArm, flowTall && bottomArmCompact, flowTall && bottomArmCompactTall]} />
      <View style={[vertical, flowTall && verticalCompact, flowTall && verticalCompactTall]} />
      <View
        style={[
          middleArm,
          flowTall && middleArmCompact,
          flowTall && middleArmCompactTall,
          afterSemis && withQuarterfinals && middleArmSemiFinal,
          afterSemis && withQuarterfinals && flowTall && middleArmSemiFinalTall,
        ]}
      />
    </View>
  );
}

function KnockoutHeaderFlowSpacer({ flowTall, layout }) {
  return (
    <View
      style={[
        layout.flowCol,
        flowTall && layout.flowColTall,
        flowTall && layout.flowColCompact,
        layout.headerFlowSpacer,
      ]}
    />
  );
}

function KnockoutStageHeaderTitle({ label, layout, mirrorTwoLegPad }) {
  return (
    <View style={layout.semiLabelRow}>
      <Text style={layout.stageColumnTitle}>{label}</Text>
      {mirrorTwoLegPad ? (
        <View style={layout.twoLegScoreCols}>
          <View style={layout.headerLegColSpacer} />
          <View style={layout.headerLegColSpacer} />
        </View>
      ) : null}
    </View>
  );
}

function KnockoutHeaderStageCell({ label, titleWide, layout, mirrorTwoLegPad, isQuarter = false }) {
  const colStyle = isQuarter
    ? [layout.quarterCol, titleWide && layout.stageColWide]
    : [layout.stageCol, titleWide && layout.stageColWide];
  return (
    <View style={colStyle}>
      <KnockoutStageHeaderTitle label={label} layout={layout} mirrorTwoLegPad={mirrorTwoLegPad} />
    </View>
  );
}

function KnockoutHeaderFinalCell({ layout }) {
  return (
    <View style={layout.finalHeaderCol}>
      <KnockoutStageHeaderTitle label="Finale" layout={layout} />
    </View>
  );
}

function KnockoutStageTies({
  ties,
  tieLabelPrefix,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  onTieLayout,
}) {
  return ties.map((tie, idx) => {
    const block = (
      <KnockoutSemiTieBlock
        tie={tie}
        sfIndex={idx}
        tieLabelPrefix={tieLabelPrefix}
        onPressMatch={onPressMatch}
        LogoComponent={LogoComponent}
        styles={tieBlockStyles}
      />
    );
    if (!onTieLayout) {
      return (
        <React.Fragment key={`${tieLabelPrefix}-tie-${idx}-${tie.legs.map((l) => l.id).join('-')}`}>
          {block}
        </React.Fragment>
      );
    }
    return (
      <View
        key={`${tieLabelPrefix}-tie-${idx}-${tie.legs.map((l) => l.id).join('-')}`}
        collapsable={false}
        onLayout={(e) => onTieLayout(idx, e)}
      >
        {block}
      </View>
    );
  });
}

function KnockoutStageColumn({
  titleWide,
  ties,
  tieLabelPrefix,
  isQuarter = false,
  bare = false,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  layout,
  onTieLayout,
}) {
  const tiesContent = (
    <KnockoutStageTies
      ties={ties}
      tieLabelPrefix={tieLabelPrefix}
      onPressMatch={onPressMatch}
      LogoComponent={LogoComponent}
      tieBlockStyles={tieBlockStyles}
      onTieLayout={onTieLayout}
    />
  );
  if (bare) return <>{tiesContent}</>;
  const colStyle = isQuarter
    ? [layout.quarterCol, titleWide && layout.stageColWide]
    : [layout.stageCol, titleWide && layout.stageColWide];
  return <View style={colStyle}>{tiesContent}</View>;
}

function KnockoutFinalMatchContent({ finalMatch, onPressMatch, LogoComponent, tieBlockStyles, layout }) {
  const finalHasShootout = hasKnockoutShootoutScore(finalMatch);
  return (
    <>
      <View style={layout.finalLabelRow} />
      <TouchableOpacity
        style={layout.matchStackMeasure}
        activeOpacity={0.78}
        disabled={!finalMatch?.id}
        onPress={() => onPressMatch?.(finalMatch?.id)}
        accessibilityRole={finalMatch?.id ? 'button' : undefined}
        accessibilityLabel={finalMatch?.id ? 'Apri partita finale' : undefined}
      >
        <View style={layout.matchStack}>
          <View style={layout.teamBox}>
            <View style={layout.teamRow}>
              {finalMatch?.home_team_name ? (
                <LogoComponent
                  logoUrl={finalMatch?.home_team_logo_url}
                  logoPath={finalMatch?.home_team_logo_path}
                  size={layout.logoSize}
                />
              ) : (
                <View style={layout.logoPlaceholder} />
              )}
              <Text style={layout.teamText} numberOfLines={1}>
                {finalMatch?.home_team_name || '-'}
              </Text>
              <View style={layout.scoreBox}>
                <KnockoutScoreText
                  score={finalMatch?.home_score}
                  shootoutScore={finalHasShootout ? finalMatch?.home_shootout_score : null}
                  styles={tieBlockStyles}
                />
              </View>
            </View>
          </View>
          <View style={layout.teamBox}>
            <View style={layout.teamRow}>
              {finalMatch?.away_team_name ? (
                <LogoComponent
                  logoUrl={finalMatch?.away_team_logo_url}
                  logoPath={finalMatch?.away_team_logo_path}
                  size={layout.logoSize}
                />
              ) : (
                <View style={layout.logoPlaceholder} />
              )}
              <Text style={layout.teamText} numberOfLines={1}>
                {finalMatch?.away_team_name || '-'}
              </Text>
              <View style={layout.scoreBox}>
                <KnockoutScoreText
                  score={finalMatch?.away_score}
                  shootoutScore={finalHasShootout ? finalMatch?.away_shootout_score : null}
                  styles={tieBlockStyles}
                />
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </>
  );
}

function KnockoutFinalColumn({
  finalMatch,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  layout,
  bare = false,
  stackedLayout = false,
}) {
  const content = (
    <KnockoutFinalMatchContent
      finalMatch={finalMatch}
      onPressMatch={onPressMatch}
      LogoComponent={LogoComponent}
      tieBlockStyles={tieBlockStyles}
      layout={layout}
    />
  );
  if (bare) return content;
  if (stackedLayout) {
    return (
      <View style={[layout.finalCol, layout.finalColBody]}>
        <View style={layout.finalMatchWrap}>{content}</View>
      </View>
    );
  }
  return <View style={layout.finalCol}>{content}</View>;
}

/**
 * Tabellone fasi finali: Quarti (se presenti) → Semifinali → Finale.
 * Con quarti: scroll orizzontale.
 */
export default function OfficialKnockoutBracket({
  knockout = EMPTY_OFFICIAL_KNOCKOUT,
  onPressMatch,
  LogoComponent,
  tieBlockStyles,
  layoutStyles,
}) {
  const k = knockout || EMPTY_OFFICIAL_KNOCKOUT;
  const quarterfinalTies = useMemo(() => groupQuarterfinalsIntoTies(k.quarterfinals), [k.quarterfinals]);
  const semifinalTies = useMemo(() => groupSemifinalsIntoTies(k.semifinals), [k.semifinals]);
  const hasQuarterfinals = quarterfinalTies.length > 0;
  const flowTall =
    semifinalTies.some((t) => t.twoLegged) ||
    quarterfinalTies.some((t) => t.twoLegged) ||
    quarterfinalTies.length > 2;

  const layout = useMemo(() => {
    const s = layoutStyles || {};
    return {
      headerRow: [s.headerRow, { alignItems: 'flex-start' }],
      stageColumnTitle: [
        s.stageColumnTitle,
        {
          fontSize: 12,
          fontWeight: '800',
          color: '#6b7280',
          textTransform: 'uppercase',
          marginBottom: 0,
        },
      ],
      semiLabelRow: s.semiLabelRow,
      twoLegScoreCols: s.twoLegScoreCols,
      headerLegColSpacer: [s.headerLegColSpacer, { minWidth: 20 }],
      headerFlowSpacer: [
        s.headerFlowSpacer,
        { height: 0, marginTop: 0, minHeight: 0, overflow: 'hidden' },
      ],
      finalHeaderCol: s.finalHeaderCol,
      finalColStack: s.finalColStack,
      finalColBody: s.finalColBody,
      finalMatchWrap: [
        s.finalMatchWrap,
        { flex: 1, justifyContent: 'center', paddingTop: 20, width: '100%' },
      ],
      bracketRow: s.bracketRow,
      bracketScroll: s.bracketScroll,
      bracketScrollContent: s.bracketScrollContent,
      quarterCol: s.stageColScroll || s.stageCol,
      stageCol: s.stageCol,
      stageColWide: s.stageColWide,
      flowCol: s.flowCol,
      flowColTall: s.flowColTall,
      flowColCompact: s.flowColCompact,
      flowColStraightStack: s.flowColStraightStack,
      flowColStraightStackTall: s.flowColStraightStackTall,
      flowStraightHeaderSpacer: s.flowStraightHeaderSpacer,
      flowStraightTieSlot: s.flowStraightTieSlot,
      flowStraightTieSlotTall: s.flowStraightTieSlotTall,
      flowStraightFirstTieSlot: s.flowStraightFirstTieSlot,
      flowStraightSecondTieSlot: s.flowStraightSecondTieSlot,
      flowStraightSecondTieSlotTall: s.flowStraightSecondTieSlotTall,
      flowStraightLine: s.flowStraightLine,
      flowStraightLineTall: s.flowStraightLineTall,
      flowStraightLineCompact: s.flowStraightLineCompact,
      flowColSemiFinal: hasQuarterfinals ? s.flowColSemiFinal : null,
      flowColSemiFinalTall: hasQuarterfinals ? s.flowColSemiFinalTall : null,
      topArm: s.bracketTopArm,
      topArmCompact: s.bracketTopArmCompact,
      topArmCompactTall: s.bracketTopArmCompactTall,
      bottomArm: s.bracketBottomArm,
      bottomArmCompact: s.bracketBottomArmCompact,
      bottomArmCompactTall: s.bracketBottomArmCompactTall,
      vertical: s.bracketVertical,
      verticalCompact: s.bracketVerticalCompact,
      verticalCompactTall: s.bracketVerticalCompactTall,
      middleArm: s.bracketMiddleArm,
      middleArmCompact: s.bracketMiddleArmCompact,
      middleArmCompactTall: s.bracketMiddleArmCompactTall,
      middleArmSemiFinal: hasQuarterfinals ? s.middleArmSemiFinal : null,
      middleArmSemiFinalTall: hasQuarterfinals ? s.middleArmSemiFinalTall : null,
      finalCol: s.finalCol,
      finalLabelRow: s.finalLabelRow,
      matchStackMeasure: s.matchStackMeasure,
      matchStack: s.matchStack,
      teamBox: s.teamBox,
      teamRow: s.teamRow,
      teamText: s.teamText,
      scoreBox: s.scoreBox,
      logoPlaceholder: s.logoPlaceholder,
      logoSize: s.logoSize ?? KNOCKOUT_BRACKET_LOGO_SIZE,
    };
  }, [layoutStyles, hasQuarterfinals]);

  const semiHeaderLabel =
    semifinalTies.length > 1 || semifinalTies.some((t) => t.twoLegged) ? 'Semifinali' : 'Semifinale';
  const semiTwoLegged = semifinalTies.some((t) => t.twoLegged);
  const quarterTwoLegged = quarterfinalTies.some((t) => t.twoLegged);

  const commonStageProps = {
    onPressMatch,
    LogoComponent,
    tieBlockStyles,
    layout,
  };

  const quarterTieMeasureKey = useMemo(
    () => quarterfinalTies.map((tie) => `${tie.latestMatchId || ''}-${tie.legs.map((l) => l.id).join('-')}`).join('|'),
    [quarterfinalTies]
  );
  const [quarterLineCentersY, setQuarterLineCentersY] = useState(null);
  const quarterTieMeasuresRef = useRef({});

  useEffect(() => {
    quarterTieMeasuresRef.current = {};
    setQuarterLineCentersY(null);
  }, [quarterTieMeasureKey]);

  const handleQuarterTieLayout = useCallback(
    (idx, event) => {
      const { y, height } = event.nativeEvent.layout;
      if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return;
      quarterTieMeasuresRef.current[idx] = y + height / 2;
      const expected = quarterfinalTies.length;
      if (expected <= 0) return;
      const centers = Array.from({ length: expected }, (_, i) => quarterTieMeasuresRef.current[i]);
      if (centers.every((v) => Number.isFinite(v) && v >= 0)) {
        setQuarterLineCentersY(centers);
      }
    },
    [quarterfinalTies.length]
  );

  if (hasQuarterfinals) {
    const quarterColStyle = [layout.quarterCol, flowTall && layout.stageColWide];
    const stageColStyle = [layout.stageCol, flowTall && layout.stageColWide];
    const finalColStyle = [layout.finalCol, layout.finalColStack];

    return (
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          persistentScrollbar={Platform.OS === 'android'}
          indicatorStyle="black"
          scrollIndicatorInsets={{ bottom: 2 }}
          style={layout.bracketScroll}
          contentContainerStyle={layout.bracketScrollContent}
        >
          <View style={layout.bracketRow}>
            <View style={quarterColStyle} collapsable={false}>
              <KnockoutStageHeaderTitle label="Quarti" layout={layout} mirrorTwoLegPad={quarterTwoLegged} />
              <KnockoutStageColumn
                ties={quarterfinalTies}
                tieLabelPrefix="QF"
                bare
                onTieLayout={handleQuarterTieLayout}
                {...commonStageProps}
              />
            </View>
            <KnockoutFlowConnector
              flowTall={flowTall}
              layout={layout}
              quarterTies={quarterfinalTies}
              quarterLineCentersY={quarterLineCentersY}
              afterQuarters
              withQuarterfinals
            />
            <View style={stageColStyle}>
              <KnockoutStageHeaderTitle
                label={semiHeaderLabel}
                layout={layout}
                mirrorTwoLegPad={semiTwoLegged}
              />
              <KnockoutStageColumn ties={semifinalTies} tieLabelPrefix="SF" bare {...commonStageProps} />
            </View>
            <KnockoutFlowConnector flowTall={flowTall} layout={layout} afterSemis withQuarterfinals />
            <View style={finalColStyle}>
              <KnockoutStageHeaderTitle label="Finale" layout={layout} />
              <View style={layout.finalMatchWrap}>
                <KnockoutFinalColumn finalMatch={k.final} bare {...commonStageProps} />
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  const header = (
    <View style={[layout.bracketRow, layout.headerRow]}>
      <KnockoutHeaderStageCell
        label={semiHeaderLabel}
        titleWide={flowTall}
        layout={layout}
        mirrorTwoLegPad={semiTwoLegged}
      />
      <KnockoutHeaderFlowSpacer flowTall={flowTall} layout={layout} />
      <KnockoutHeaderFinalCell layout={layout} />
    </View>
  );

  const bracketBody = (
    <View style={layout.bracketRow}>
      <KnockoutStageColumn titleWide={flowTall} ties={semifinalTies} tieLabelPrefix="SF" {...commonStageProps} />
      <KnockoutFlowConnector flowTall={flowTall} layout={layout} afterSemis />
      <KnockoutFinalColumn finalMatch={k.final} {...commonStageProps} />
    </View>
  );

  return (
    <View>
      {header}
      {bracketBody}
    </View>
  );
}
