<?php
require_once 'db.php';
require_once 'functions.php';
session_start();

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit();
}

$user_id = $_SESSION['user_id'];
$league_id = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;

// Get league info
$stmt = $conn->prepare("SELECT * FROM leagues WHERE id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$league = $stmt->get_result()->fetch_assoc();

if (!$league) {
    header('Location: dashboard.php');
    exit();
}

// Check if user is member of the league
$stmt = $conn->prepare("SELECT role FROM league_members WHERE user_id = ? AND league_id = ?");
$stmt->bind_param("ii", $user_id, $league_id);
$stmt->execute();
$member = $stmt->get_result()->fetch_assoc();

if (!$member) {
    header('Location: dashboard.php');
    exit();
}

// Check if user is admin (for future reference, but not used in this view-only version)
$is_admin = ($league['creator_id'] == $user_id);

// Recupera le giornate dal database
$stmt = $conn->prepare("SELECT id, giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY deadline ASC");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$result = $stmt->get_result();

$events = [];
while ($row = $result->fetch_assoc()) {
    $deadline = new DateTime($row['deadline']);
    
    // Verifica se l'utente ha già inviato la formazione per questa giornata
    $formation_status = '';
    $has_formation = false;
    if ($league['auto_lineup_mode']) {
        // In modalità automatica, non serve controllare la formazione
        $has_formation = true;
    } else {
        $stmt_formation = $conn->prepare("SELECT COUNT(*) as count FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
        $stmt_formation->bind_param("iii", $user_id, $league_id, $row['giornata']);
        $stmt_formation->execute();
        $result_formation = $stmt_formation->get_result();
        $row_formation = $result_formation->fetch_assoc();
        $has_formation = $row_formation['count'] > 0;
    }
    $events[] = [
        'id' => $row['id'],
        'title' => 'Giornata ' . $row['giornata'],
        'start' => $deadline->format('Y-m-d'),
        'allDay' => true,
        'backgroundColor' => $has_formation ? '#28a745' : '#dc3545',
        'borderColor' => $has_formation ? '#28a745' : '#dc3545',
        'textColor' => '#ffffff',
        'giornata' => $row['giornata'],
        'deadline_time' => $deadline->format('H:i')
    ];
}
?>

<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Calendario - <?php echo htmlspecialchars($league['name']); ?></title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/fullcalendar@5.11.3/main.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
    <style>
        .navbar-brand i {
            margin-right: 5px;
        }
        .nav-link i {
            margin-right: 5px;
        }
        .card-calendar { box-shadow: 0 2px 8px #0001; }
        .badge-giornata { font-size: 1em; background: #0d6efd; }
        .badge-deadline { background: #ffc107; color: #212529; }
        .fc .fc-toolbar-title { font-size: 1.3em; }
        .fc-event { font-size: 1em; cursor: pointer; }
        .fc-event:hover { opacity: 0.8; }
        .legend-item {
            display: inline-flex;
            align-items: center;
            margin-right: 20px;
            margin-bottom: 10px;
        }
        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 3px;
            margin-right: 8px;
        }
        @media (max-width: 575.98px) {
            h1, .card-header, .form-label, .btn, .form-control, .alert, .table th, .table td { font-size: 0.95em !important; }
            .btn, .btn-primary, .btn-outline-primary, .btn-sm { font-size: 0.92em !important; padding: 0.28em 0.5em !important; }
            .form-control, .form-control-sm { font-size: 0.92em !important; padding: 0.28em 0.5em !important; }
            .card, .card-sm { margin-bottom: 0.7rem !important; }
            .table th, .table td { padding: 0.18em 0.12em !important; font-size: 0.92em !important; }
            .fc .fc-toolbar-title { font-size: 1em !important; }
            .fc .fc-button { font-size: 0.92em !important; padding: 0.18em 0.5em !important; height: 2em !important; min-width: 2em !important; }
            .fc .fc-col-header-cell-cushion, .fc .fc-daygrid-day-number { font-size: 0.92em !important; padding: 0.08em 0.1em !important; }
            .fc .fc-daygrid-day { min-height: 2.1em !important; }
            .fc .fc-toolbar.fc-header-toolbar { margin-bottom: 0.5em !important; }
            .legend-item { margin-right: 10px !important; margin-bottom: 6px !important; font-size: 0.92em !important; }
            .legend-color { width: 15px !important; height: 15px !important; margin-right: 5px !important; }
            .alert-info { font-size: 0.92em !important; padding: 0.5em 0.7em !important; }
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@5.11.3/main.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@5.11.3/locales-all.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</head>
<body class="bg-light fc-calendar-page">
    <?php include 'navbar.php'; ?>
    
    <div class="container fc-page-container">
        <div class="fc-calendar-header">
            <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-calendar me-2 text-primary"></i>Calendario - <?php echo htmlspecialchars($league['name']); ?></h4>
        </div>
        
        <div class="row">
            <div class="col-md-12">
                <div class="card card-calendar fc-calendar-main-card mb-4">
                    <div class="card-header bg-primary text-white d-flex align-items-center">
                        <i class="bi bi-calendar-event me-2"></i>
                        <h5 class="mb-0">Calendario Giornate</h5>
                    </div>
                    <div class="card-body">
                        <div class="alert alert-info mb-3">
                            <i class="bi bi-info-circle"></i> Visualizza le giornate della lega e lo stato delle tue formazioni.
                            <?php if ($league['auto_lineup_mode']): ?>
                                <br><b>In questa lega la formazione viene schierata automaticamente ogni giornata: il sistema selezionerà i migliori per ruolo tra i tuoi disponibili. Non è necessario inviare la formazione.</b>
                            <?php endif; ?>
                        </div>
                        
                        <!-- Legenda -->
                        <div class="mb-3">
                            <h6><i class="bi bi-info-circle"></i> Legenda:</h6>
                            <div class="legend-item">
                                <div class="legend-color" style="background-color: #28a745;"></div>
                                <span>Formazione inviata<?php if ($league['auto_lineup_mode']): ?> (o automatica)<?php endif; ?></span>
                            </div>
                            <?php if (!$league['auto_lineup_mode']): ?>
                            <div class="legend-item">
                                <div class="legend-color" style="background-color: #dc3545;"></div>
                                <span>Formazione da inviare</span>
                            </div>
                            <?php endif; ?>
                        </div>
                        
                        <div id="calendar" style="max-width: 100%; height: 600px;"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal per informazioni giornata -->
    <div class="modal fade" id="giornataModal" tabindex="-1" aria-labelledby="giornataModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header bg-warning text-dark">
                    <h5 class="modal-title" id="giornataModalLabel">
                        <i class="bi bi-calendar-event-fill"></i> Informazioni Giornata
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        <div class="col-12">
                            <div class="d-flex align-items-center mb-3">
                                <i class="bi bi-info-circle-fill text-primary me-2" style="font-size: 1.2em;"></i>
                                <h6 class="mb-0 fw-bold" id="giornataTitle"></h6>
                            </div>
                            <div class="d-flex align-items-center mb-3">
                                <i class="bi bi-calendar-date-fill text-success me-2" style="font-size: 1.2em;"></i>
                                <span class="fw-semibold" id="giornataDate"></span>
                            </div>
                            <div class="d-flex align-items-center mb-3">
                                <i class="bi bi-clock-fill text-warning me-2" style="font-size: 1.2em;"></i>
                                <span class="fw-semibold" id="giornataTime"></span>
                            </div>
                            <div class="alert alert-info border-0 shadow-sm" role="alert">
                                <div class="d-flex align-items-center">
                                    <i class="bi bi-lightbulb-fill text-warning me-2" style="font-size: 1.1em;"></i>
                                    <div>
                                        <strong>Suggerimento:</strong><br>
                                        <?php if ($league['auto_lineup_mode']): ?>
                                            In questa lega la formazione viene schierata automaticamente ogni giornata.
                                        <?php else: ?>
                                            Clicca su "Gestisci Formazione" per impostare la tua formazione per questa giornata.
                                        <?php endif; ?>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                        <i class="bi bi-x-circle"></i> Chiudi
                    </button>
                    <a href="#" class="btn btn-primary" id="goToFormationBtn">
                        <i class="bi bi-clipboard-data"></i> Gestisci Formazione
                    </a>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
                initialView: 'dayGridMonth',
                locale: 'it',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,dayGridWeek'
                },
                height: 'auto',
                contentHeight: 550,
                selectable: false, // Disabilita la selezione per utenti non admin
                eventClick: function(info) {
                    // Mostra informazioni dettagliate della giornata nel modal
                    const event = info.event;
                    const title = event.title;
                    const start = event.start.toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                    const time = event.extendedProps.deadline_time;
                    
                    // Determina se la formazione è stata inviata dal colore dell'evento
                    const hasFormation = event.backgroundColor === '#28a745';
                    
                    // Popola il modal
                    const titleElement = document.getElementById('giornataTitle');
                    const dateElement = document.getElementById('giornataDate');
                    const timeElement = document.getElementById('giornataTime');
                    const formationBtn = document.getElementById('goToFormationBtn');
                    const modalHeader = document.querySelector('#giornataModal .modal-header');
                    const modalTitle = document.getElementById('giornataModalLabel');
                    const suggestionAlert = document.querySelector('#giornataModal .alert');
                    
                    if (titleElement) titleElement.textContent = title;
                    if (dateElement) dateElement.textContent = start;
                    if (timeElement) timeElement.textContent = `Orario limite: ${time}`;
                    
                    // Cambia il colore dell'header e il messaggio in base allo stato della formazione
                    if (hasFormation) {
                        // Formazione già inviata - header verde
                        modalHeader.className = 'modal-header bg-success text-white';
                        modalTitle.innerHTML = '<i class="bi bi-check-circle-fill"></i> Formazione Inviata';
                        
                        // Nascondi il pulsante formazione e cambia il suggerimento
                        if (formationBtn) formationBtn.style.display = 'none';
                        if (suggestionAlert) {
                            suggestionAlert.className = 'alert alert-success border-0 shadow-sm';
                            suggestionAlert.innerHTML = `
                                <div class="d-flex align-items-center">
                                    <i class="bi bi-check-circle-fill text-success me-2" style="font-size: 1.1em;"></i>
                                    <div>
                                        <strong>Perfetto!</strong><br>
                                        Hai già inviato la formazione per questa giornata.
                                    </div>
                                </div>
                            `;
                        }
                    } else {
                        // Formazione non inviata - header giallo
                        modalHeader.className = 'modal-header bg-warning text-dark';
                        modalTitle.innerHTML = '<i class="bi bi-calendar-event-fill"></i> Informazioni Giornata';
                        
                        // Mostra il pulsante formazione e il suggerimento originale
                        if (formationBtn) {
                            formationBtn.style.display = 'inline-block';
                            formationBtn.href = `formazione.php?league_id=<?php echo $league_id; ?>&giornata=${event.extendedProps.giornata}`;
                        }
                        if (suggestionAlert) {
                            suggestionAlert.className = 'alert alert-info border-0 shadow-sm';
                            suggestionAlert.innerHTML = `
                                <div class="d-flex align-items-center">
                                    <i class="bi bi-lightbulb-fill text-warning me-2" style="font-size: 1.1em;"></i>
                                    <div>
                                        <strong>Suggerimento:</strong><br>
                                        <?php if ($league['auto_lineup_mode']): ?>
                                            In questa lega la formazione viene schierata automaticamente ogni giornata.
                                        <?php else: ?>
                                            Clicca su "Gestisci Formazione" per impostare la tua formazione per questa giornata.
                                        <?php endif; ?>
                                    </div>
                                </div>
                            `;
                        }
                    }
                    
                    // Mostra il modal
                    const modalElement = document.getElementById('giornataModal');
                    if (modalElement) {
                        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                            const modal = new bootstrap.Modal(modalElement);
                            modal.show();
                        } else {
                            console.error('Bootstrap Modal not available!'); // Debug
                            // Fallback: mostra alert se Bootstrap non è disponibile
                            alert(`Giornata: ${title}\nData: ${start}\nOrario limite: ${time}\n\nClicca su "Formazione" nella navbar per gestire la tua formazione per questa giornata.`);
                        }
                    } else {
                        console.error('Modal element not found!'); // Debug
                        // Fallback: mostra alert se il modal non funziona
                        alert(`Giornata: ${title}\nData: ${start}\nOrario limite: ${time}\n\nClicca su "Formazione" nella navbar per gestire la tua formazione per questa giornata.`);
                    }
                }
            });
            
            calendar.render();
            
            // Aggiungi gli eventi esistenti
            <?php foreach ($events as $event): ?>
            calendar.addEvent({
                title: '<?php echo addslashes($event['title']); ?>',
                start: '<?php echo $event['start']; ?>',
                allDay: <?php echo $event['allDay'] ? 'true' : 'false'; ?>,
                backgroundColor: '<?php echo $event['backgroundColor']; ?>',
                borderColor: '<?php echo $event['borderColor']; ?>',
                textColor: '<?php echo $event['textColor']; ?>',
                extendedProps: {
                    giornata: <?php echo $event['giornata']; ?>,
                    deadline_time: '<?php echo $event['deadline_time']; ?>',
                    id: <?php echo $event['id']; ?>
                }
            });
            <?php endforeach; ?>
        });
    </script>
</body>
</html> 