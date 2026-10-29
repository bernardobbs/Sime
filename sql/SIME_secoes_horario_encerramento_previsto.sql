-- Previsão de horário de encerramento/transmissão por seção para 2026,
-- 27/09/2026 — pedido direto, a partir de um arquivo real do cartório
-- ("Tempo_de_Transmissão.xlsx", aba "Previsão 2026", com histórico desde
-- 2016) que já traz, por seção, a previsão de que horário o processamento/
-- transmissão daquela seção deve terminar (coluna HORARIO_FINAL_PREVISTO —
-- modelo estatístico sobre eleitores/comparecimento estimado, não um
-- palpite): "o horario de finalização da seção mais demorada deve
-- impactar o horario de saída do primeiro lugar da rota e de cada uma das
-- paradas".
--
-- `sime_secoes.horario_encerramento_previsto` (TIME, nullable) — mesmo
-- padrão de campo opcional livre já usado por `uc_equatorial`/
-- `codigo_rastreio` (nunca cravado, sempre dado real trazido pelo
-- cartório). Consumida pelo módulo 🗺️ Rotas (`rtCalcularHorariosParadas`
-- em `sime_rotas_modulo.js`) pra impor um PISO por parada: o veículo de
-- recolhimento nunca sai de uma parada antes desse horário, mesmo que a
-- viagem/carregamento tenha sido mais rápida — e isso empurra em cascata o
-- horário de saída sugerido pro início da rota e a previsão de chegada em
-- cada parada seguinte. Nunca bloqueia nada — é só um piso usado no
-- CÁLCULO da sugestão, sempre editável por cima (mesma filosofia de
-- Partida/Destino/Previsão de chegada).
--
-- Rodado uma vez via SQL Editor/MCP (não é migração, não reaplica sozinha)
-- — 175 seções da planilha bateram, por NÚMERO, contra a 7ª Zona: dessas,
-- 146 eram as ativas atuais (todas exceto a 263, Penitenciária, adicionada
-- depois da vistoria e fora do escopo desta planilha histórica); as
-- outras 29 batem contra seções hoje `ativo=false` no SIME (achado real,
-- não investigado a fundo aqui: o cadastro tem seções superseded/
-- duplicadas por prédio que ainda são referenciadas por 84 paradas de
-- rota — grava o horário nelas também, sem custo, pro dado já estar
-- pronto se esse cadastro for revisado). Um número da planilha (262) não
-- bate com NENHUMA seção da 7ª Zona (nem ativa, nem inativa) — fica de
-- fora, sem inventar.
update sime_secoes s
set horario_encerramento_previsto = v.horario::time
from (values
  (1,'18:09:00'), (2,'17:27:00'), (3,'17:26:00'), (4,'13:28:00'), (5,'13:22:00'), (6,'14:36:00'), (12,'14:36:00'), (14,'15:26:00'), (15,'12:24:00'), (16,'15:51:00'), (17,'18:20:00'), (18,'15:42:00'), (19,'18:20:00'), (20,'15:42:00'), (29,'16:08:00'), (30,'16:21:00'), (31,'16:01:00'), (33,'17:33:00'), (34,'17:33:00'), (35,'17:47:00'), (36,'17:47:00'), (37,'15:26:00'), (38,'13:28:00'), (44,'13:44:00'), (45,'15:59:00'), (46,'13:03:00'), (47,'15:59:00'), (49,'17:27:00'), (50,'18:09:00'), (62,'17:01:00'), (63,'17:02:00'), (64,'17:22:00'), (65,'17:14:00'), (66,'16:43:00'), (71,'17:09:00'), (74,'15:42:00'), (79,'17:55:00'), (80,'17:45:00'), (81,'17:34:00'), (85,'17:18:00'), (86,'17:08:00'), (87,'17:03:00'), (88,'17:21:00'), (89,'17:06:00'), (90,'17:02:00'), (101,'15:16:00'), (102,'15:15:00'), (103,'16:01:00'), (112,'15:16:00'), (115,'17:33:00'), (116,'13:03:00'), (117,'15:59:00'), (122,'16:54:00'), (123,'16:10:00'), (124,'17:00:00'), (125,'15:51:00'), (126,'16:39:00'), (128,'17:47:00'), (132,'16:01:00'), (133,'17:40:00'), (135,'14:38:00'), (136,'18:19:00'), (137,'13:54:00'), (138,'17:43:00'), (139,'18:24:00'), (140,'16:25:00'), (141,'15:43:00'), (144,'15:19:00'), (145,'16:54:00'), (147,'17:14:00'), (148,'16:35:00'), (149,'14:36:00'), (151,'16:10:00'), (152,'18:13:00'), (155,'16:57:00'), (156,'16:39:00'), (157,'18:20:00'), (158,'15:55:00'), (159,'17:09:00'), (160,'17:51:00'), (162,'12:13:00'), (163,'13:46:00'), (164,'15:50:00'), (165,'17:18:00'), (166,'18:13:00'), (167,'18:24:00'), (168,'14:58:00'), (171,'16:01:00'), (172,'11:52:00'), (173,'16:47:00'), (174,'17:48:00'), (175,'17:49:00'), (176,'15:15:00'), (177,'16:01:00'), (178,'16:53:00'), (179,'17:51:00'), (180,'15:59:00'), (181,'16:52:00'), (185,'17:00:00'), (186,'12:26:00'), (187,'14:39:00'), (188,'18:30:00'), (189,'12:52:00'), (191,'14:05:00'), (192,'15:31:00'), (193,'18:41:00'), (194,'17:53:00'), (195,'18:36:00'), (196,'17:02:00'), (197,'13:17:00'), (198,'16:49:00'), (199,'14:06:00'), (200,'15:21:00'), (201,'14:54:00'), (202,'17:04:00'), (203,'17:52:00'), (204,'17:21:00'), (205,'16:11:00'), (206,'15:50:00'), (207,'16:27:00'), (208,'16:03:00'), (209,'13:18:00'), (210,'17:48:00'), (211,'17:13:00'), (212,'16:42:00'), (213,'13:05:00'), (214,'17:13:00'), (215,'16:50:00'), (216,'18:33:00'), (217,'15:34:00'), (218,'12:47:00'), (219,'16:18:00'), (220,'13:54:00'), (221,'17:09:00'), (222,'18:22:00'), (223,'17:18:00'), (224,'17:48:00'), (225,'12:21:00'), (226,'15:56:00'), (227,'17:27:00'), (228,'16:30:00'), (229,'15:27:00'), (230,'16:12:00'), (231,'12:45:00'), (232,'17:44:00'), (233,'14:33:00'), (234,'18:36:00'), (235,'15:56:00'), (236,'14:47:00'), (237,'17:26:00'), (238,'13:07:00'), (239,'14:30:00'), (240,'16:27:00'), (241,'15:13:00'), (242,'14:29:00'), (243,'15:51:00'), (244,'14:55:00'), (245,'12:11:00'), (246,'12:39:00'), (247,'12:19:00'), (248,'15:27:00'), (249,'16:39:00'), (250,'14:24:00'), (251,'16:56:00'), (252,'15:38:00'), (253,'13:27:00'), (254,'14:51:00'), (255,'14:27:00'), (256,'14:55:00'), (257,'13:40:00'), (258,'12:13:00'), (259,'13:54:00'), (260,'17:44:00'), (261,'13:10:00'), (262,'16:27:00')
) as v(numero, horario)
where s.zona_id = (select id from sime_zonas where numero = 7)
  and s.numero = v.numero;
