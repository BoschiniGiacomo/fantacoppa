import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

export function hasKnockoutShootoutScore(matchRow) {
  return Number.isFinite(Number(matchRow?.home_shootout_score)) && Number.isFinite(Number(matchRow?.away_shootout_score));
}

export function KnockoutScoreText({ score, shootoutScore, styles }) {
  return (
    <View style={styles.knockoutScoreTextRow}>
      <Text style={styles.knockoutScoreText}>{score != null ? String(score) : ''}</Text>
      {shootoutScore != null ? (
        <>
          <View style={styles.knockoutShootoutDivider} />
          <Text style={styles.knockoutShootoutScoreText}>{shootoutScore}</Text>
        </>
      ) : null}
    </View>
  );
}

function teamLegScore(leg, teamId) {
  if (!leg) return { score: null, shootout: null };
  const tid = Number(teamId);
  if (!Number.isFinite(tid) || tid <= 0) return { score: null, shootout: null };
  const isHome = Number(leg.home_team_id) === tid;
  const scoreRaw = isHome ? leg.home_score : leg.away_score;
  const shoRaw = isHome ? leg.home_shootout_score : leg.away_shootout_score;
  const score = scoreRaw != null && Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null;
  return {
    score,
    shootout: hasKnockoutShootoutScore(leg) ? shoRaw : null,
  };
}

function KnockoutScoreCell({ score, shootout, styles }) {
  return (
    <View style={styles.knockoutScoreBox}>
      <KnockoutScoreText score={score} shootoutScore={shootout} styles={styles} />
    </View>
  );
}

function KnockoutTeamRow({ match, side, styles, LogoComponent }) {
  const isHome = side === 'home';
  const name = isHome ? match?.home_team_name : match?.away_team_name;
  const score = isHome ? match?.home_score : match?.away_score;
  const shootout = isHome ? match?.home_shootout_score : match?.away_shootout_score;
  const logoUrl = isHome ? match?.home_team_logo_url : match?.away_team_logo_url;
  const logoPath = isHome ? match?.home_team_logo_path : match?.away_team_logo_path;
  const hasShootout = hasKnockoutShootoutScore(match);

  return (
    <View style={styles.knockoutTeamBox}>
      <View style={styles.knockoutTeamRow}>
        {name ? <LogoComponent logoUrl={logoUrl} logoPath={logoPath} size={30} /> : <View style={styles.knockoutLogoPlaceholder} />}
        <Text style={styles.knockoutTeamText} numberOfLines={1}>
          {name || '-'}
        </Text>
        <KnockoutScoreCell score={score} shootout={hasShootout ? shootout : null} styles={styles} />
      </View>
    </View>
  );
}

function KnockoutTwoLegTeamRow({ team, leg1, leg2, styles, LogoComponent }) {
  return (
    <View style={styles.knockoutTeamBox}>
      <View style={styles.knockoutTeamRow}>
        {team?.name ? (
          <LogoComponent logoUrl={team.logo_url} logoPath={team.logo_path} size={30} />
        ) : (
          <View style={styles.knockoutLogoPlaceholder} />
        )}
        <Text style={styles.knockoutTeamText} numberOfLines={1}>
          {team?.name || '-'}
        </Text>
        <View style={styles.knockoutTwoLegScoreCols}>
          <KnockoutScoreCell score={leg1?.score} shootout={leg1?.shootout} styles={styles} />
          <KnockoutScoreCell score={leg2?.score} shootout={leg2?.shootout} styles={styles} />
        </View>
      </View>
    </View>
  );
}

function KnockoutTwoLegUnifiedCard({ tie, styles, LogoComponent }) {
  const leg1 = tie.legs[0];
  const leg2 = tie.legs[1];
  const teamA = tie.teamA;
  const teamB = tie.teamB;

  return (
    <View style={styles.knockoutMatchStack}>
      <KnockoutTwoLegTeamRow
        team={teamA}
        leg1={teamLegScore(leg1, teamA?.id)}
        leg2={teamLegScore(leg2, teamA?.id)}
        styles={styles}
        LogoComponent={LogoComponent}
      />
      <KnockoutTwoLegTeamRow
        team={teamB}
        leg1={teamLegScore(leg1, teamB?.id)}
        leg2={teamLegScore(leg2, teamB?.id)}
        styles={styles}
        LogoComponent={LogoComponent}
      />
    </View>
  );
}

/**
 * Blocco semifinale: una partita o andata+ritorno (colonne 1° / 2° sulla riga SF).
 * Tap apre l'ultima partita del tie (ritorno se presente).
 */
export default function KnockoutSemiTieBlock({
  tie,
  sfIndex,
  onPressMatch,
  LogoComponent,
  styles,
}) {
  const pressId = tie?.twoLegged ? tie?.latestMatchId : tie?.legs?.[0]?.id;
  const disabled = !pressId;

  return (
    <View style={styles.knockoutSemiBlock}>
      <View style={styles.knockoutSemiLabelRow}>
        <Text style={styles.knockoutSemiSmallLabel}>SF {sfIndex + 1}</Text>
        {tie?.twoLegged ? (
          <View style={styles.knockoutTwoLegScoreCols}>
            <Text style={styles.knockoutLegColLabel}>1°</Text>
            <Text style={styles.knockoutLegColLabel}>2°</Text>
          </View>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.knockoutMatchStackMeasure}
        activeOpacity={0.78}
        disabled={disabled}
        onPress={() => onPressMatch?.(pressId)}
        accessibilityRole={disabled ? undefined : 'button'}
        accessibilityLabel={disabled ? undefined : `Apri semifinale ${sfIndex + 1}`}
      >
        <View style={styles.knockoutTieStack}>
          {tie?.twoLegged ? (
            <>
              <KnockoutTwoLegUnifiedCard tie={tie} styles={styles} LogoComponent={LogoComponent} />
              {tie.aggregate ? (
                <Text style={styles.knockoutAggregateText}>
                  Complessivo: {tie.aggregate.home} - {tie.aggregate.away}
                </Text>
              ) : null}
            </>
          ) : (
            <View style={styles.knockoutMatchStack}>
              <KnockoutTeamRow match={tie?.legs?.[0]} side="home" styles={styles} LogoComponent={LogoComponent} />
              <KnockoutTeamRow match={tie?.legs?.[0]} side="away" styles={styles} LogoComponent={LogoComponent} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}
