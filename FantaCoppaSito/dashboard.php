<?php
require_once 'functions.php';
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: index.php');
    exit();
}

$error = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        if ($_POST['action'] === 'create_league') {
            $name = $_POST['league_name'] ?? '';
            $accessCode = !empty($_POST['access_code']) ? $_POST['access_code'] : null;
            $initialBudget = isset($_POST['initial_budget']) ? (int)$_POST['initial_budget'] : 100;
            
            if (createLeague($name, $accessCode, $initialBudget)) {
                $success = 'Lega creata con successo!';
            } else {
                $error = 'Errore nella creazione della lega.';
            }
        } elseif ($_POST['action'] === 'join_league') {
            $selectedId = $_POST['selected_league_id'] ?? '';
            $input = trim($_POST['league_name_join'] ?? '');
            if ($selectedId) {
                $leagueValue = $selectedId;
                $searchType = 'id';
            } elseif (ctype_digit($input)) {
                $leagueValue = $input;
                $searchType = 'id';
            } else {
                $leagueValue = $input;
                $searchType = 'name';
            }
            $accessCode = !empty($_POST['join_access_code']) ? $_POST['join_access_code'] : null;
            $joinResult = joinLeague($leagueValue, $accessCode, $searchType);
            if ($joinResult === true) {
                $success = 'Iscrizione alla lega effettuata con successo!';
            } elseif ($joinResult === 'already_joined') {
                $error = 'Sei già iscritto a questa lega.';
            } elseif ($joinResult === 'not_found') {
                $error = 'Lega non trovata.';
            } else {
                $error = 'Errore nell\'iscrizione alla lega. Codice di accesso non valido.';
            }
        }
    }
}

$leagues = getUserLeagues();

// Arricchisci dati per replica UI mobile app (conteggio utenti + stato mercato)
if (!empty($leagues)) {
    $conn = getDbConnection();
    $membersStmt = $conn->prepare("SELECT COUNT(*) AS user_count FROM league_members WHERE league_id = ?");
    $marketStmt = $conn->prepare("SELECT market_locked FROM league_market_settings WHERE league_id = ? LIMIT 1");

    foreach ($leagues as &$leagueItem) {
        $leagueId = (int)($leagueItem['id'] ?? 0);

        $membersStmt->bind_param("i", $leagueId);
        $membersStmt->execute();
        $memberRow = $membersStmt->get_result()->fetch_assoc();
        $leagueItem['user_count'] = isset($memberRow['user_count']) ? (int)$memberRow['user_count'] : 0;

        $marketStmt->bind_param("i", $leagueId);
        $marketStmt->execute();
        $marketRow = $marketStmt->get_result()->fetch_assoc();
        $leagueItem['market_locked'] = isset($marketRow['market_locked']) ? (int)$marketRow['market_locked'] : 0;
    }
    unset($leagueItem);

    $membersStmt->close();
    $marketStmt->close();
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-dashboard-page">
    <div class="container fc-page-container">
        <nav class="fc-app-top-nav d-none d-lg-flex" aria-label="Navigazione desktop">
            <a class="fc-app-top-link active" href="dashboard.php">
                <i class="bi bi-house-fill"></i>
                <span>Home</span>
            </a>
            <a class="fc-app-top-link" href="leghe.php">
                <i class="bi bi-trophy"></i>
                <span>Leghe</span>
            </a>
            <a class="fc-app-top-link" href="profile.php">
                <i class="bi bi-person"></i>
                <span>Profilo</span>
            </a>
        </nav>

        <div id="alerts"></div>
        <?php 
    $pendingRequests = getUserPendingRequests($_SESSION['user_id']);
    if (!empty($pendingRequests)): ?>
        <div class="alert alert-info alert-dismissible fade show" role="alert">
            <i class="bi bi-info-circle-fill me-2"></i>
            <div>
                <strong>⚠️ Hai richieste di iscrizione in attesa di approvazione:</strong><br>
                <?php foreach ($pendingRequests as $request): ?>
                    <div class="mt-2">
                        <strong><?php echo htmlspecialchars($request['league_name']); ?></strong> 
                        (richiesta inviata il <?php echo date('d/m/Y H:i', strtotime($request['requested_at'])); ?>)
                    </div>
                <?php endforeach; ?>
                <div class="mt-2">
                    <small>Non potrai accedere alle funzionalità di queste leghe finché un amministratore non approverà la tua richiesta.</small>
                </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
        </div>
<?php endif; ?>
        <div id="dynamicAlertContainer"></div>
        <?php if ($error): ?>
            <div class="alert alert-danger alert-dismissible fade show d-flex align-items-center" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                <div><?php echo htmlspecialchars($error); ?></div>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
            </div>
        <?php endif; ?>
        <?php if ($success): ?>
            <div class="alert alert-success alert-dismissible fade show d-flex align-items-center" role="alert">
                <i class="bi bi-check-circle-fill me-2"></i>
                <div><?php echo htmlspecialchars($success); ?></div>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
            </div>
        <?php endif; ?>
        <div class="fc-dashboard-mobile d-lg-none">
            <div class="fc-dashboard-mobile-header">
                <h4 class="mb-0 fw-bold text-dark">Le Mie Leghe</h4>
            </div>
            <div class="fc-dashboard-mobile-search">
                <i class="bi bi-search"></i>
                <input type="text" class="form-control border-0 shadow-none" id="searchMyLeaguesMobile" placeholder="Cerca leghe...">
            </div>
            <div id="mobileLeaguesContent"></div>
            <div class="d-flex justify-content-center mt-2 mb-1">
                <button class="btn btn-outline-secondary btn-sm" id="showArchivedBtnMobile"><i class="bi bi-archive"></i> Leghe archiviate</button>
            </div>
            <div id="mobileArchivedContainer" class="d-none"></div>
        </div>

        <section class="fc-dashboard-desktop d-none d-lg-block">
            <div class="fc-dashboard-desktop-header">
                <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-trophy me-2 text-primary"></i>Le Mie Leghe</h4>
            </div>

            <div class="fc-dashboard-desktop-search-row">
                <div class="fc-dashboard-desktop-filter">
                    <input type="text" class="form-control border-0 shadow-none" id="searchMyLeaguesDesktop" placeholder="Cerca leghe...">
                </div>
            </div>

            <div id="desktopLeaguesContent"></div>
            <div class="fc-desktop-archive-action">
                <button class="btn btn-outline-secondary btn-sm" id="showArchivedBtnDesktop"><i class="bi bi-archive"></i> Leghe archiviate</button>
            </div>
            <div id="desktopArchivedContainer" class="d-none"></div>
        </section>
    </div>
    <!-- Modal per codice accesso -->
    <div class="modal fade" id="accessCodeModal" tabindex="-1" aria-labelledby="accessCodeModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="accessCodeModalLabel">Codice di Accesso Richiesto</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>Questa lega richiede un codice di accesso. Inseriscilo per continuare:</p>
            <input type="password" class="form-control" id="modalAccessCode" placeholder="Codice di accesso">
            <div class="invalid-feedback" id="accessCodeError"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annulla</button>
            <button type="button" class="btn btn-success" id="confirmAccessCodeBtn">Unisciti</button>
          </div>
        </div>
      </div>
    </div>
    <!-- Modal conferma join -->
    <div class="modal fade" id="confirmJoinModal" tabindex="-1" aria-labelledby="confirmJoinModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="confirmJoinModalLabel">Conferma Iscrizione</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>Vuoi unirti alla lega <span id="confirmLeagueName"></span>?</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annulla</button>
            <button type="button" class="btn btn-success" id="confirmJoinBtn">Unisciti</button>
          </div>
        </div>
      </div>
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    const leagueSearchInput = document.getElementById('league_search');
    const resultsBox = document.getElementById('leagueSearchResults');
    let leaguesCache = [];
    let selectedLeague = null;
    if (leagueSearchInput && resultsBox) {
        leagueSearchInput.addEventListener('input', function() {
            const query = this.value.trim();
            if (query.length < 1) {
                resultsBox.innerHTML = '';
                resultsBox.style.display = 'none';
                return;
            }
            fetch('search_leagues.php?q=' + encodeURIComponent(query) + '&details=1')
                .then(res => res.json())
                .then(data => {
                    leaguesCache = data;
                    resultsBox.innerHTML = '';
                    if (data.length > 0) {
                        data.forEach(league => {
                            const item = document.createElement('button');
                            item.type = 'button';
                            item.className = 'list-group-item list-group-item-action';
                            item.innerHTML = `<b>${league.name}</b> <span class='text-muted'>(ID: ${league.id})</span>` + (league.access_code ? " <span class='badge bg-warning text-dark ms-2'>Codice richiesto</span>" : "");
                            item.onclick = function() {
                                selectedLeague = league;
                                resultsBox.innerHTML = '';
                                resultsBox.style.display = 'none';
                                if (league.access_code) {
                                    document.getElementById('modalAccessCode').value = '';
                                    document.getElementById('accessCodeError').textContent = '';
                                    new bootstrap.Modal(document.getElementById('accessCodeModal')).show();
                                } else {
                                    document.getElementById('confirmLeagueName').textContent = league.name;
                                    new bootstrap.Modal(document.getElementById('confirmJoinModal')).show();
                                }
                            };
                            resultsBox.appendChild(item);
                        });
                        resultsBox.style.display = 'block';
                    } else {
                        resultsBox.innerHTML = '<div class="list-group-item text-center text-muted">Nessuna lega trovata o sei già iscritto a tutte quelle corrispondenti.</div>';
                        resultsBox.style.display = 'block';
                    }
                });
        });
        document.addEventListener('click', function(e) {
            if (!leagueSearchInput.contains(e.target) && !resultsBox.contains(e.target)) {
                resultsBox.innerHTML = '';
                resultsBox.style.display = 'none';
            }
        });
    }
    // Join con codice
    const confirmAccessCodeBtn = document.getElementById('confirmAccessCodeBtn');
    if (confirmAccessCodeBtn) {
        confirmAccessCodeBtn.onclick = function() {
            const code = document.getElementById('modalAccessCode').value.trim();
            if (!code) {
                document.getElementById('accessCodeError').textContent = 'Inserisci il codice.';
                document.getElementById('modalAccessCode').classList.add('is-invalid');
                return;
            }
            document.getElementById('modalAccessCode').classList.remove('is-invalid');
            document.getElementById('accessCodeError').textContent = '';
            joinLeague(selectedLeague.id, code);
            bootstrap.Modal.getInstance(document.getElementById('accessCodeModal')).hide();
        };
    }
    // Join senza codice
    const confirmJoinBtn = document.getElementById('confirmJoinBtn');
    if (confirmJoinBtn) {
        confirmJoinBtn.onclick = function() {
            joinLeague(selectedLeague.id, '');
            bootstrap.Modal.getInstance(document.getElementById('confirmJoinModal')).hide();
        };
    }
    function joinLeague(leagueId, accessCode) {
    fetch('join_league.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league_id: leagueId, access_code: accessCode })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            if (data.requires_approval) {
                // Mostra alert dinamico subito senza refresh
                const alertsDiv = document.getElementById('alerts');
                if (alertsDiv) {
                    alertsDiv.innerHTML = `
                        <div class="alert alert-info alert-dismissible fade show" role="alert">
                            <i class="bi bi-info-circle-fill me-2"></i>
                            <div>
                                <strong>⚠️ Richiesta inviata!</strong><br>
                                La tua iscrizione alla lega <strong>${data.league_name}</strong>
                                è in attesa di approvazione dall’amministratore.
                            </div>
                            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
                        </div>
                    `;
                }
            } else if (data.redirect) {
                window.location.href = data.redirect;
            } else {
                window.location.reload();
            }
        } else {
            showDynamicAlert(data.error || 'Errore nell\'iscrizione alla lega.');
        }
    });
}


    function showDynamicAlert(message) {
        const container = document.getElementById('dynamicAlertContainer');
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show d-flex align-items-center';
        alert.role = 'alert';
        alert.innerHTML = `
            <i class="bi bi-exclamation-triangle-fill me-2"></i>
            <div>${message}</div>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
        `;
        container.innerHTML = '';
        container.appendChild(alert);
        // Scrolla in alto per visibilità
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function getLeaguePrefs() {
        // Stato iniziale dal backend
        return window.serverLeaguePrefs || JSON.parse(localStorage.getItem('leaguePrefs') || '{}');
    }
    function setLeaguePrefs(prefs) {
        localStorage.setItem('leaguePrefs', JSON.stringify(prefs));
    }
    function updateLeaguePrefOnServer(leagueId, favorite, archived) {
        fetch('update_league_pref.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ league_id: leagueId, favorite: favorite ? 1 : 0, archived: archived ? 1 : 0 })
        });
    }
    function getSearchValue() {
        const mobileInput = document.getElementById('searchMyLeaguesMobile');
        const desktopInput = document.getElementById('searchMyLeaguesDesktop');
        if (window.matchMedia('(max-width: 991.98px)').matches) {
            return mobileInput ? mobileInput.value.trim().toLowerCase() : '';
        }
        return desktopInput ? desktopInput.value.trim().toLowerCase() : '';
    }

    function getRoleBadge(leagueRole) {
        if (leagueRole === 'admin') {
            return '<span class="badge badge-role-admin">Admin</span>';
        }
        if (leagueRole === 'pagellatore') {
            return '<span class="badge badge-role-pagellatore">Pagellatore</span>';
        }
        return '<span class="badge badge-role-user">Utente</span>';
    }

    function getLeagueCardHtml(league, isFav, isArch, mobile = false) {
        const autoLineupEnabled = league.auto_lineup_mode === 1 || league.auto_lineup_mode === true || league.auto_lineup_mode === '1';
        const marketClosed = league.market_locked === 1 || league.market_locked === true || league.market_locked === '1';
        const currentMatchday = league.current_matchday ? `${league.current_matchday}ª giornata` : 'Non iniziata';
        const members = Number(league.user_count || 0);

        return `
            <div class="card h-100 fc-league-tile position-relative ${mobile ? 'fc-mobile-league-card' : ''}" data-go-league="${league.id}">
                <div class="card-body">
                    <div class="fc-mobile-card-top">
                        <div class="fc-mobile-card-title">
                            <i class="bi bi-trophy-fill text-warning"></i>
                            <span>${league.name}</span>
                        </div>
                        <div class="fc-mobile-card-actions">
                            <button class="btn btn-link p-0 me-2 toggle-fav" data-id="${league.id}" title="${isFav ? 'Togli dai preferiti' : 'Rendi preferita'}" tabindex="-1">
                                <i class="bi ${isFav ? 'bi-star-fill text-warning' : 'bi-star'}"></i>
                            </button>
                            <button class="btn btn-link p-0 toggle-arch" data-id="${league.id}" title="${isArch ? 'Ripristina' : 'Archivia'}" tabindex="-1">
                                <i class="bi ${isArch ? 'bi-archive-fill text-secondary' : 'bi-archive'}"></i>
                            </button>
                        </div>
                    </div>
                    <div class="fc-mobile-card-middle">
                        ${getRoleBadge(league.role)}
                        <span class="fc-mobile-members"><i class="bi bi-people"></i> ${members}</span>
                    </div>
                    <div class="fc-league-meta">
                        <div><i class="bi bi-calendar-event"></i> ${currentMatchday}</div>
                        <div>Auto-formazione: <span class="${autoLineupEnabled ? 'fc-value-good' : 'fc-value-bad'}">${autoLineupEnabled ? 'Si' : 'No'}</span></div>
                        <div>Mercato: <span class="${marketClosed ? 'fc-value-bad' : 'fc-value-good'}">${marketClosed ? 'Chiuso' : 'Aperto'}</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    function attachLeagueCardEvents(container, prefs) {
        container.querySelectorAll('[data-go-league]').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-go-league');
                window.location.href = `league.php?id=${id}`;
            });
        });

        container.querySelectorAll('.toggle-fav, .toggle-arch').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
    }

    function renderLeagues(leagues, prefs, container, archived) {
        container.innerHTML = '';
        let filtered = leagues.filter(l => !!l);
        if (!archived) {
            filtered = filtered.filter(l => !prefs[l.id] || !prefs[l.id].archived);
        } else {
            filtered = filtered.filter(l => prefs[l.id] && prefs[l.id].archived);
        }
        const search = getSearchValue();
        if (search) {
            filtered = filtered.filter(l => l.name.toLowerCase().includes(search) || (''+l.id).includes(search));
        }
        // Preferite in alto
        filtered.sort((a, b) => {
            const ap = prefs[a.id]?.favorite ? -1 : 0;
            const bp = prefs[b.id]?.favorite ? -1 : 0;
            if (ap !== bp) return ap - bp;
            return a.name.localeCompare(b.name);
        });
        if (filtered.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted">Nessuna lega trovata.</div>';
            return;
        }
        filtered.forEach(league => {
            const isFav = prefs[league.id]?.favorite;
            const isArch = prefs[league.id]?.archived;
            const card = document.createElement('div');
            card.className = 'col-12 col-md-6';
            card.innerHTML = getLeagueCardHtml(league, isFav, isArch, false);
            container.appendChild(card);
        });
        attachLeagueCardEvents(container, prefs);
        // Eventi preferito/archivia
        container.querySelectorAll('.toggle-fav').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].favorite = !prefs[id].favorite;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                btn.querySelector('i').className = 'bi ' + (prefs[id].favorite ? 'bi-star-fill text-warning' : 'bi-star');
                btn.title = prefs[id].favorite ? 'Togli dai preferiti' : 'Rendi preferita';
                renderAll();
            };
        });
        container.querySelectorAll('.toggle-arch').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].archived = !prefs[id].archived;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                btn.querySelector('i').className = 'bi ' + (prefs[id].archived ? 'bi-archive-fill text-secondary' : 'bi-archive');
                btn.title = prefs[id].archived ? 'Ripristina' : 'Archivia';
                renderAll();
            };
        });
    }

    function renderMobileSections(leagues, prefs, contentEl) {
        contentEl.innerHTML = '';
        let filtered = leagues.filter(l => !!l && !(prefs[l.id] && prefs[l.id].archived));

        const search = getSearchValue();
        if (search) {
            filtered = filtered.filter(l => l.name.toLowerCase().includes(search) || ('' + l.id).includes(search));
        }

        filtered.sort((a, b) => {
            const ap = prefs[a.id]?.favorite ? -1 : 0;
            const bp = prefs[b.id]?.favorite ? -1 : 0;
            if (ap !== bp) return ap - bp;
            return a.name.localeCompare(b.name);
        });

        const favorites = filtered.filter(l => !!prefs[l.id]?.favorite);
        const others = filtered.filter(l => !prefs[l.id]?.favorite);

        const makeSection = (title, iconClass, list, forceShow = false) => {
            if (!forceShow && list.length === 0) return '';
            const cards = list.map(league => {
                const isFav = !!prefs[league.id]?.favorite;
                const isArch = !!prefs[league.id]?.archived;
                return `<div class="fc-mobile-league-wrap">${getLeagueCardHtml(league, isFav, isArch, true)}</div>`;
            }).join('');

            return `
                <section class="fc-mobile-dashboard-section">
                    <div class="fc-mobile-dashboard-section-title"><i class="bi ${iconClass}"></i> ${title} <span>(${list.length})</span></div>
                    ${cards || '<div class="text-center text-muted small py-2">Nessuna lega</div>'}
                </section>
            `;
        };

        contentEl.innerHTML =
            makeSection('Preferite', 'bi-star-fill', favorites, true) +
            makeSection('Tutte le Leghe', 'bi-trophy', others, true);

        attachLeagueCardEvents(contentEl, prefs);

        contentEl.querySelectorAll('.toggle-fav').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].favorite = !prefs[id].favorite;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });

        contentEl.querySelectorAll('.toggle-arch').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].archived = !prefs[id].archived;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
    }

    function renderMobileArchived(leagues, prefs, container) {
        if (!container) return;
        let archived = leagues.filter(l => prefs[l.id] && prefs[l.id].archived);
        const search = getSearchValue();
        if (search) {
            archived = archived.filter(l => l.name.toLowerCase().includes(search) || ('' + l.id).includes(search));
        }
        archived.sort((a, b) => a.name.localeCompare(b.name));

        if (archived.length === 0) {
            container.innerHTML = '<div class="text-center text-muted small py-2">Nessuna lega archiviata.</div>';
            return;
        }

        container.innerHTML = `
            <section class="fc-mobile-dashboard-section">
                <div class="fc-mobile-dashboard-section-title"><i class="bi bi-archive"></i> Archiviate <span>(${archived.length})</span></div>
                ${archived.map(league => {
                    const isFav = !!prefs[league.id]?.favorite;
                    const isArch = !!prefs[league.id]?.archived;
                    return `<div class="fc-mobile-league-wrap">${getLeagueCardHtml(league, isFav, isArch, true)}</div>`;
                }).join('')}
            </section>
        `;

        attachLeagueCardEvents(container, prefs);
        container.querySelectorAll('.toggle-fav').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].favorite = !prefs[id].favorite;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
        container.querySelectorAll('.toggle-arch').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].archived = !prefs[id].archived;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
    }

    function renderDesktopSections(leagues, prefs, contentEl) {
        contentEl.innerHTML = '';
        let filtered = leagues.filter(l => !!l && !(prefs[l.id] && prefs[l.id].archived));

        const search = getSearchValue();
        if (search) {
            filtered = filtered.filter(l => l.name.toLowerCase().includes(search) || ('' + l.id).includes(search));
        }

        filtered.sort((a, b) => {
            const ap = prefs[a.id]?.favorite ? -1 : 0;
            const bp = prefs[b.id]?.favorite ? -1 : 0;
            if (ap !== bp) return ap - bp;
            return a.name.localeCompare(b.name);
        });

        const favorites = filtered.filter(l => !!prefs[l.id]?.favorite);
        const others = filtered.filter(l => !prefs[l.id]?.favorite);

        const buildGrid = (items) => {
            if (items.length === 0) {
                return '<div class="text-center text-muted small py-2">Nessuna lega</div>';
            }
            return `<div class="row g-3">${items.map(league => {
                const isFav = !!prefs[league.id]?.favorite;
                const isArch = !!prefs[league.id]?.archived;
                return `<div class="col-12"><div class="fc-mobile-league-wrap mb-0">${getLeagueCardHtml(league, isFav, isArch, false)}</div></div>`;
            }).join('')}</div>`;
        };

        contentEl.innerHTML = `
            <div class="row g-3">
                <div class="col-12 col-xxl-6">
                    <section class="fc-desktop-dashboard-section">
                        <div class="fc-desktop-dashboard-section-title"><i class="bi bi-star-fill"></i> Preferite <span>(${favorites.length})</span></div>
                        ${buildGrid(favorites)}
                    </section>
                </div>
                <div class="col-12 col-xxl-6">
                    <section class="fc-desktop-dashboard-section">
                        <div class="fc-desktop-dashboard-section-title"><i class="bi bi-trophy"></i> Tutte le Leghe <span>(${others.length})</span></div>
                        ${buildGrid(others)}
                    </section>
                </div>
            </div>
        `;

        attachLeagueCardEvents(contentEl, prefs);
        contentEl.querySelectorAll('.toggle-fav').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].favorite = !prefs[id].favorite;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
        contentEl.querySelectorAll('.toggle-arch').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].archived = !prefs[id].archived;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
    }

    function renderDesktopArchived(leagues, prefs, container) {
        if (!container) return;
        let archived = leagues.filter(l => prefs[l.id] && prefs[l.id].archived);
        const search = getSearchValue();
        if (search) {
            archived = archived.filter(l => l.name.toLowerCase().includes(search) || ('' + l.id).includes(search));
        }
        archived.sort((a, b) => a.name.localeCompare(b.name));

        if (archived.length === 0) {
            container.innerHTML = '<div class="text-center text-muted small py-2">Nessuna lega archiviata.</div>';
            return;
        }

        container.innerHTML = `
            <section class="fc-desktop-dashboard-section">
                <div class="fc-desktop-dashboard-section-title"><i class="bi bi-archive"></i> Archiviate <span>(${archived.length})</span></div>
                <div class="row g-3">
                    ${archived.map(league => {
                        const isFav = !!prefs[league.id]?.favorite;
                        const isArch = !!prefs[league.id]?.archived;
                        return `<div class="col-12"><div class="fc-mobile-league-wrap mb-0">${getLeagueCardHtml(league, isFav, isArch, false)}</div></div>`;
                    }).join('')}
                </div>
            </section>
        `;

        attachLeagueCardEvents(container, prefs);
        container.querySelectorAll('.toggle-fav').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].favorite = !prefs[id].favorite;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
        container.querySelectorAll('.toggle-arch').forEach(btn => {
            btn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                prefs[id] = prefs[id] || {};
                prefs[id].archived = !prefs[id].archived;
                setLeaguePrefs(prefs);
                updateLeaguePrefOnServer(id, prefs[id].favorite, prefs[id].archived);
                renderAll();
            };
        });
    }

    function renderAll() {
        const prefs = getLeaguePrefs();
        const isMobile = window.matchMedia('(max-width: 991.98px)').matches;

        if (isMobile) {
            const mobileContent = document.getElementById('mobileLeaguesContent');
            const mobileArchived = document.getElementById('mobileArchivedContainer');
            renderMobileSections(window.myLeagues, prefs, mobileContent);
            renderMobileArchived(window.myLeagues, prefs, mobileArchived);
            return;
        }

        const desktopContent = document.getElementById('desktopLeaguesContent');
        const desktopArchived = document.getElementById('desktopArchivedContainer');
        renderDesktopSections(window.myLeagues, prefs, desktopContent);
        renderDesktopArchived(window.myLeagues, prefs, desktopArchived);
    }
    document.addEventListener('DOMContentLoaded', function() {
        window.myLeagues = <?php echo json_encode($leagues); ?>;
        window.serverLeaguePrefs = <?php echo json_encode(isLoggedIn() ? getUserLeaguePrefs(getCurrentUserId()) : []); ?>;
        renderAll();
        const searchDesktop = document.getElementById('searchMyLeaguesDesktop');
        const searchMobile = document.getElementById('searchMyLeaguesMobile');
        if (searchDesktop) {
            searchDesktop.addEventListener('input', renderAll);
        }
        if (searchMobile) {
            searchMobile.addEventListener('input', renderAll);
        }

        const showArchivedBtnMobile = document.getElementById('showArchivedBtnMobile');
        if (showArchivedBtnMobile) {
            showArchivedBtnMobile.addEventListener('click', function() {
                const mobileArchived = document.getElementById('mobileArchivedContainer');
                mobileArchived.classList.toggle('d-none');
            });
        }

        const showArchivedBtnDesktop = document.getElementById('showArchivedBtnDesktop');
        if (showArchivedBtnDesktop) {
            showArchivedBtnDesktop.addEventListener('click', function() {
                const desktopArchived = document.getElementById('desktopArchivedContainer');
                desktopArchived.classList.toggle('d-none');
            });
        }

        window.addEventListener('resize', renderAll);
    });
    </script>

    <nav class="fc-mobile-main-nav d-lg-none" aria-label="Navigazione principale">
        <a class="fc-mobile-main-nav-link active" href="dashboard.php">
            <i class="bi bi-house-fill"></i>
            <span>Home</span>
        </a>
        <a class="fc-mobile-main-nav-link" href="leghe.php">
            <i class="bi bi-trophy"></i>
            <span>Leghe</span>
        </a>
        <a class="fc-mobile-main-nav-link" href="profile.php">
            <i class="bi bi-person"></i>
            <span>Profilo</span>
        </a>
    </nav>
</body>
</html>
