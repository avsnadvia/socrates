-- v4.7: campo de aniversário (formato MM-DD) para a tarefa diária de parabéns
alter table socrates_usuarios add column if not exists aniversario text;
